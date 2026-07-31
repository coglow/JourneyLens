import type { Prisma } from '@prisma/client';
import { createPrismaClient } from '../../src/db/client.js';
import {
  DEMO_AUDIENCE_EXTERNAL_PREFIX,
  DEMO_AUDIENCE_SEED,
  generateDemoAudience,
} from './seed-audience-generator.js';

// 分批写入，避免单条 SQL 参数过多；2,000 人分成 4 批。
const CREATE_BATCH_SIZE = 500;

function countBy(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, count]) => `${label} ${count}`)
    .join('、');
}

function printSummary(users: ReturnType<typeof generateDemoAudience>): void {
  const attributes = users.map((user) => user.attributes);
  console.log(`固定种子：${DEMO_AUDIENCE_SEED}`);
  console.log(`会员等级：${countBy(attributes.map((item) => String(item.vipLevel ?? '未填写')))}`);
  console.log(`城市层级：${countBy(attributes.map((item) => String(item.cityTier ?? '未填写')))}`);
  console.log(
    `未填写：邮箱 ${users.filter((user) => user.email === null).length}、` +
      `性别 ${attributes.filter((item) => item.gender === undefined).length}、` +
      `职业 ${attributes.filter((item) => item.occupation === undefined).length}`,
  );
  console.log(
    `兴趣标签为空：${
      attributes.filter((item) => !Array.isArray(item.interests) || item.interests.length === 0)
        .length
    }、黑名单：${attributes.filter((item) => item.isBlacklisted === true).length}`,
  );
}

async function seedAudience(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL 未设置，请检查根目录 .env');
  }

  const users = generateDemoAudience();
  const records: Prisma.AudienceUserCreateManyInput[] = users.map((user) => ({
    id: user.id,
    externalId: user.externalId,
    displayName: user.displayName,
    email: user.email,
    attributes: user.attributes as Prisma.InputJsonValue,
  }));

  const prisma = createPrismaClient(databaseUrl);
  try {
    // 只替换本项目自己的演示样本，且删除与重建在同一事务里，失败不会留下半套数据。
    await prisma.$transaction(
      async (tx) => {
        // 新增执行与事件外键后，先清理这些演示受众的运行历史，再替换受众本身；
        // 其他受众、活动与发布版本不受影响。
        const demoUsers = await tx.audienceUser.findMany({
          where: { externalId: { startsWith: DEMO_AUDIENCE_EXTERNAL_PREFIX } },
          select: { id: true },
        });
        const demoUserIds = demoUsers.map((user) => user.id);
        if (demoUserIds.length > 0) {
          // 步骤随执行级联删除，然后才能删除被触发行为引用的演示事件。
          await tx.execution.deleteMany({ where: { audienceUserId: { in: demoUserIds } } });
          await tx.event.deleteMany({ where: { audienceUserId: { in: demoUserIds } } });
        }

        await tx.audienceUser.deleteMany({
          where: { externalId: { startsWith: DEMO_AUDIENCE_EXTERNAL_PREFIX } },
        });
        for (let index = 0; index < records.length; index += CREATE_BATCH_SIZE) {
          await tx.audienceUser.createMany({
            data: records.slice(index, index + CREATE_BATCH_SIZE),
          });
        }
      },
      { timeout: 60_000 },
    );

    const total = await prisma.audienceUser.count();
    console.log(`演示受众已初始化：本次 ${users.length} 人，数据库共有 ${total} 人`);
    console.log('已同时清理这些演示受众关联的执行、步骤和事件记录。');
    printSummary(users);
  } finally {
    await prisma.$disconnect();
  }
}

seedAudience().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '未知错误';
  const safeMessage = message.replace(/postgres(?:ql)?:\/\/[^\s)'"`]+/gi, '[数据库连接串已隐藏]');
  console.error(`seed:audience 失败：${safeMessage}`);
  process.exitCode = 1;
});
