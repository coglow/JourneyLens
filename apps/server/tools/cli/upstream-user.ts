import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { AUDIENCE_COLUMN_KEYS, audienceField, validateFieldValue } from '@journeylens/shared';
import type { Prisma } from '@prisma/client';
import { createPrismaClient } from '../../src/db/client.js';

const sampleSchema = z
  .array(
    z
      .object({
        externalId: z
          .string({ error: '用户 ID 不能为空' })
          .trim()
          .min(1, '用户 ID 不能为空')
          .max(160, '用户 ID 最多 160 个字符'),
        displayName: z
          .string({ error: '用户昵称不能为空' })
          .trim()
          .min(1, '用户昵称不能为空')
          .max(120, '用户昵称最多 120 个字符'),
        email: z.string().max(320, '邮箱最多 320 个字符').nullish(),
        attributes: z.record(z.string(), z.json()).default({}),
      })
      .strict(),
  )
  .min(1, '样本文件至少包含一名用户');

type SampleUser = z.output<typeof sampleSchema>[number];

function validateAttributes(user: SampleUser): void {
  for (const [key, value] of Object.entries(user.attributes)) {
    // 昵称和邮箱是基础列，不接受混进属性对象；其余字段必须来自现有属性目录。
    if (
      (AUDIENCE_COLUMN_KEYS as readonly string[]).includes(key) ||
      audienceField(key) === undefined
    ) {
      throw new Error(`用户 ${user.externalId} 的资料包含不支持的属性：${key}`);
    }
    const message = validateFieldValue(audienceField(key)!, value);
    if (message !== undefined) {
      throw new Error(`用户 ${user.externalId} 的${message}`);
    }
  }
}

async function prepareUsers(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      file: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (typeof values.file !== 'string') {
    throw new Error('请提供 --file 指向用户样本文件');
  }

  const content = await readFile(values.file, 'utf8');
  const parsed = sampleSchema.safeParse(JSON.parse(content));
  if (!parsed.success) {
    throw new Error(`用户样本无效：${parsed.error.issues[0]?.message ?? '请检查字段'}`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL 未设置，请检查根目录 .env');
  }

  const prisma = createPrismaClient(databaseUrl);
  try {
    for (const user of parsed.data) {
      validateAttributes(user);
      const email = user.email?.trim() || null;
      const existing = await prisma.audienceUser.findUnique({
        where: { externalId: user.externalId },
        select: { id: true },
      });
      await prisma.audienceUser.upsert({
        where: { externalId: user.externalId },
        update: {
          displayName: user.displayName,
          email,
          attributes: user.attributes as Prisma.InputJsonValue,
        },
        create: {
          id: randomUUID(),
          externalId: user.externalId,
          displayName: user.displayName,
          email,
          attributes: user.attributes as Prisma.InputJsonValue,
        },
      });
      console.log(
        `${existing === null ? '已创建' : '已更新'}演示用户：${user.externalId}（${user.displayName}）`,
      );
    }
    // 该工具只准备用户资料，不写入事件、执行或步骤记录。
    console.log('用户资料准备完成；行为请由行为注入工具单独发送。');
  } finally {
    await prisma.$disconnect();
  }
}

prepareUsers().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '未知错误';
  const safeMessage = message.replace(/postgres(?:ql)?:\/\/[^\s)'"`]+/gi, '[数据库连接串已隐藏]');
  console.error(`upstream:user 失败：${safeMessage}`);
  process.exitCode = 1;
});
