import type { Prisma } from '@prisma/client';
import type { JourneyEventType } from '@journeylens/shared';
import { getEventMatchReason, type EventCandidate } from '../journeys/event-matching.js';

/** 活动固定目标：行为类型与是否要求同一商品。 */
export interface GoalConfig {
  eventType: JourneyEventType;
  sameProduct: boolean;
}

export interface GoalEvent {
  id: string;
  type: JourneyEventType;
  receivedAt: Date;
  payload: Prisma.JsonValue;
}

/**
 * 在本次推进已能读到的行为中，找出最早满足活动目标的一条。
 *
 */
export async function findGoalEvent(
  tx: Prisma.TransactionClient,
  input: {
    audienceUserId: string;
    entryEvent: EventCandidate & { id: string };
    startedAt: Date;
    goal: GoalConfig;
  },
): Promise<GoalEvent | undefined> {
  const candidates = await tx.event.findMany({
    where: {
      audienceUserId: input.audienceUserId,
      type: input.goal.eventType,
      // 进入行为本身和进入前的历史行为都不参与目标判断。
      receivedAt: { gte: input.startedAt },
      id: { not: input.entryEvent.id },
    },
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, type: true, receivedAt: true, payload: true },
  });

  return candidates.find(
    (candidate) =>
      getEventMatchReason({
        candidate: { type: candidate.type, payload: candidate.payload as Record<string, unknown> },
        expectedType: input.goal.eventType,
        entryEvent: input.entryEvent,
        sameProduct: input.goal.sameProduct,
      }) === undefined,
  );
}

/**
 * 达成目标后结束本次参与：目标事实、当前等待终止和执行结束在同一次事务里写入。
 *
 * 只把仍在等待的步骤改为已停止，已完成步骤和消息结果保持原样；不写等待步骤的匹配行为，
 * 也不追加结束步骤，指针保持目标确认时的位置。
 */
export async function completeExecutionByGoal(
  tx: Prisma.TransactionClient,
  input: { executionId: string; event: { id: string; receivedAt: Date }; endedAt: Date },
): Promise<void> {
  await tx.executionStep.updateMany({
    where: { executionId: input.executionId, status: 'waiting' },
    data: { status: 'stopped', endedAt: input.endedAt },
  });
  await tx.execution.update({
    where: { id: input.executionId },
    data: {
      status: 'completed',
      endedAt: input.endedAt,
      goalReachedAt: input.event.receivedAt,
      goalEventId: input.event.id,
      failureReason: null,
    },
  });
}
