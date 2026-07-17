import { buildApp } from './app.js';

async function start(): Promise<void> {
  const rawPort = process.env.PORT ?? '3001';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 必须是 1 到 65535 之间的整数，当前值：${rawPort}`);
  }

  const app = buildApp();
  const address = await app.listen({ port, host: '0.0.0.0' });
  app.log.info({ address }, 'JourneyLens API 已启动');
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '未知错误';
  const safeMessage = message.replace(/postgres(?:ql)?:\/\/[^\s)'"`]+/gi, '[数据库连接串已隐藏]');
  console.error(`JourneyLens API 启动失败：${safeMessage}`);
  process.exitCode = 1;
});
