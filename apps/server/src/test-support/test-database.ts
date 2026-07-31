import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';

export const testAccountId = 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120';
export const testNow = new Date('2026-07-16T08:00:00.000Z');

const TEST_DATABASE_IMAGE = 'postgres:16.9-alpine';
const SERVER_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface TestDatabase {
  prisma: PrismaClient;
  /** 供“重启后继续推进”用例新建独立连接。 */
  connectionUri: string;
  reset(): Promise<void>;
  close(): Promise<void>;
}

function migrate(databaseUrl: string): void {
  try {
    execFileSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--schema',
        'prisma/schema.prisma',
      ],
      {
        cwd: SERVER_ROOT,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
      },
    );
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : '';
    throw new Error(`测试数据库迁移失败：${stderr || '未知错误'}`);
  }
}

/**
 * 每个测试文件启动一个独立 PostgreSQL 容器，跑真实迁移。
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(TEST_DATABASE_IMAGE).start();
  const databaseUrl = container.getConnectionUri();

  try {
    migrate(databaseUrl);
    const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await prisma.operatorAccount.create({
      data: {
        id: testAccountId,
        email: 'Operator@Example.com',
        emailNormalized: 'operator@example.com',
        passwordHash: 'stored-argon2-hash',
        displayName: '测试运营账号',
        status: 'active',
      },
    });

    return {
      prisma,
      connectionUri: databaseUrl,
      async reset() {
        // 每个用例前清空业务数据；账号保留并恢复为可用状态，避免用例互相影响。
        await prisma.$executeRawUnsafe(
          'TRUNCATE TABLE "segments", "campaigns", "sessions", "audience_users" RESTART IDENTITY CASCADE',
        );
        await prisma.operatorAccount.update({
          where: { id: testAccountId },
          data: { status: 'active', lastLoginAt: null },
        });
      },
      async close() {
        await prisma.$disconnect();
        await container.stop();
      },
    };
  } catch (error) {
    await container.stop();
    throw error;
  }
}
