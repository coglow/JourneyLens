import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { hashPassword } from '../../src/modules/auth/password.js';
import { createPrismaClient } from '../../src/db/client.js';
import { readSecret } from './prompt.js';

async function createOperator(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      email: { type: 'string' },
      'display-name': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  if (typeof values.email !== 'string' || typeof values['display-name'] !== 'string') {
    throw new Error('请提供 --email 与 --display-name');
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL 未设置，请检查根目录 .env');
  }

  const email = values.email.trim();
  const displayName = values['display-name'].trim();
  const password = await readSecret('密码（输入不回显）: ');
  const passwordHash = await hashPassword(password);
  const prisma = createPrismaClient(databaseUrl);

  try {
    const account = await prisma.operatorAccount.create({
      data: {
        id: randomUUID(),
        email,
        emailNormalized: email.toLowerCase(),
        passwordHash,
        displayName,
      },
    });
    console.log(`运营账号已创建：${account.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

createOperator().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '未知错误';
  const safeMessage = message.replace(/postgres(?:ql)?:\/\/[^\s)'"`]+/gi, '[数据库连接串已隐藏]');
  console.error(`operator:create 失败：${safeMessage}`);
  process.exitCode = 1;
});
