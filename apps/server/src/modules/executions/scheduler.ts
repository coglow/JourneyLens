import type { PrismaClient } from '@prisma/client';
import { advanceExecution } from './runner.js';

export interface ExecutionSchedulerOptions {
  /** 唤醒频率 */
  intervalMs?: number;
  now?: () => Date;
  onError?: (error: unknown, executionId?: string) => void;
}

export interface ExecutionScheduler {
  start(): void;
  stop(): Promise<void>;
}

/**
 * 单进程数据库驱动推进循环：每轮读取未结束执行，逐条推进。
 * 上一轮未结束不会启动下一轮；停止时等待在途事务完成，不把内存计时器当成事实来源。
 */
export function createExecutionScheduler(
  prisma: PrismaClient,
  options: ExecutionSchedulerOptions = {},
): ExecutionScheduler {
  const intervalMs = options.intervalMs ?? 1000;
  const now = options.now ?? (() => new Date());
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;

  async function runOnce(): Promise<void> {
    const executions = await prisma.execution.findMany({
      where: { status: { in: ['running', 'waiting'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });

    for (const execution of executions) {
      if (stopped) return;
      try {
        await advanceExecution(prisma, execution.id, now);
      } catch (error) {
        // 单条执行失败不影响其他执行；数据库暂时不可用时下一轮重新读取可确认状态。
        options.onError?.(error, execution.id);
      }
    }
  }

  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = runOnce()
        .catch((error: unknown) => options.onError?.(error))
        .finally(() => {
          inFlight = undefined;
          scheduleNext();
        });
    }, intervalMs);
  }

  return {
    start() {
      if (stopped || timer !== undefined || inFlight !== undefined) return;
      scheduleNext();
    },
    async stop() {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (inFlight !== undefined) await inFlight;
    },
  };
}
