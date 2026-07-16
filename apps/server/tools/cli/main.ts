import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { hashPassword } from '../../src/auth/password.js';
import { createPrismaClient } from '../../src/db/client.js';

function readPassword(): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (!stdin.isTTY) {
      reject(new Error('operator:create 需要在交互终端中输入密码'));
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdout.write('密码（输入不回显）: ');
    let password = '';

    const cleanup = (error?: Error): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
      if (error !== undefined) {
        reject(error);
      } else {
        resolve(password);
      }
    };

    const onData = (chunk: Buffer): void => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') {
          cleanup();
          return;
        }
        if (char === '\u0003') {
          cleanup(new Error('密码输入已取消'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          password = password.slice(0, -1);
          continue;
        }
        password += char;
      }
    };

    stdin.on('data', onData);
  });
}

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
  const password = await readPassword();
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
