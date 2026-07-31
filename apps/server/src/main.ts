import { buildApp } from './app.js';
import { createPrismaClient } from './db/client.js';
import { createExecutionScheduler } from './modules/executions/scheduler.js';

async function start(): Promise<void> {
  const rawPort = process.env.PORT ?? '3001';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 必须是 1 到 65535 之间的整数，当前值：${rawPort}`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL 未设置，请检查根目录 .env');
  }

  // 服务和推进循环共用同一个数据库连接池；由这里统一负责关闭顺序。
  const prisma = createPrismaClient(databaseUrl);
  const app = buildApp({ prisma });
  const scheduler = createExecutionScheduler(prisma, {
    onError: (error, executionId) => {
      app.log.error({ err: error, executionId }, '执行推进失败');
    },
  });

  let closing = false;
  async function shutdown(signal: string): Promise<void> {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, '正在停止 JourneyLens API');
    // 先停止新检查并等待在途步骤事务，再关闭请求处理和数据库连接。
    await scheduler.stop();
    await app.close();
    await prisma.$disconnect();
  }

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  const address = await app.listen({ port, host: '0.0.0.0' });
  // 启动后从数据库继续处理仍运行或等待中的执行，不依赖内存任务。
  scheduler.start();
  app.log.info({ address }, 'JourneyLens API 已启动');
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '未知错误';
  const safeMessage = message.replace(/postgres(?:ql)?:\/\/[^\s)'"`]+/gi, '[数据库连接串已隐藏]');
  console.error(`JourneyLens API 启动失败：${safeMessage}`);
  process.exitCode = 1;
});
