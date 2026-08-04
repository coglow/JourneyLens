import type { Prisma, PrismaClient } from '@prisma/client';
import {
  compareSegmentValue,
  readSegmentRuleValue,
  type SegmentAudienceInput,
} from '../segments/rule-evaluator.js';
import {
  getEventMatchReason,
  readEventPayloadValue,
  type EventCandidate,
} from '../journeys/event-matching.js';
import { lockCampaignForExecution } from '../campaigns/campaign-lock.js';
import { completeExecutionByGoal, findGoalEvent } from './goal.js';
import type {
  EventSummary,
  ExecutionStepOutput,
  JourneyBranch,
  JourneyConditionRule,
  JourneyDraftDefinition,
  JourneyDraftNode,
  JourneyVersionSnapshot,
} from '@journeylens/shared';

export type AdvanceResult = 'waiting' | 'completed' | 'failed' | 'stopped' | 'missing';

type ActiveStatus = 'running' | 'waiting';

interface AdvanceContext {
  tx: Prisma.TransactionClient;
  execution: {
    id: string;
    audienceUserId: string;
    triggerEventId: string;
    currentNodeId: string;
    status: ActiveStatus;
  };
  definition: JourneyDraftDefinition;
  audience: SegmentAudienceInput;
  triggerEvent: EventSummary;
  now: Date;
}

class ExecutionBusinessError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ExecutionBusinessError';
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

type ConditionValueEvidence = Extract<
  Extract<ExecutionStepOutput, { kind: 'condition' }>['evidence'],
  { kind: 'value' }
>;
type ConditionEvidenceValue = Extract<ConditionValueEvidence['actual'], { exists: true }>['value'];

function toEvidenceValue(value: unknown): ConditionValueEvidence['actual'] {
  return value === undefined
    ? { exists: false }
    : { exists: true, value: value as ConditionEvidenceValue };
}

function triggerEventSummary(event: {
  id: string;
  type: EventSummary['type'];
  receivedAt: Date;
  payload: Prisma.JsonValue;
}): EventSummary {
  return {
    id: event.id,
    type: event.type,
    receivedAt: event.receivedAt.toISOString(),
    payload: event.payload as unknown as EventSummary['payload'],
  };
}

function nextNode(
  definition: JourneyDraftDefinition,
  sourceNode: JourneyDraftNode,
  branch?: JourneyBranch,
): JourneyDraftNode {
  const edge = definition.edges.find(
    (candidate) =>
      candidate.source === sourceNode.id &&
      (branch === undefined ? candidate.branch === undefined : candidate.branch === branch),
  );
  if (edge === undefined) {
    throw new ExecutionBusinessError(
      branch === undefined ? '流程缺少下一步，无法继续执行' : '流程缺少对应分支，无法继续执行',
    );
  }
  const target = definition.nodes.find((node) => node.id === edge.target);
  if (target === undefined) {
    throw new ExecutionBusinessError('下一步骤不存在，无法继续执行');
  }
  return target;
}

function serializeAudience(audience: {
  displayName: string;
  email: string | null;
  attributes: Prisma.JsonValue;
}): SegmentAudienceInput {
  return {
    displayName: audience.displayName,
    email: audience.email,
    attributes: audience.attributes,
  };
}

async function currentOrder(tx: Prisma.TransactionClient, executionId: string): Promise<number> {
  // 执行行已加锁，同一执行不会并发分配同一个序号。
  const last = await tx.executionStep.findFirst({
    where: { executionId },
    orderBy: { order: 'desc' },
    select: { order: true },
  });
  return (last?.order ?? 0) + 1;
}

async function updatePointer(
  tx: Prisma.TransactionClient,
  executionId: string,
  status: 'running' | 'waiting',
  currentNodeId: string,
): Promise<void> {
  await tx.execution.update({
    where: { id: executionId },
    data: { status, currentNodeId },
  });
}

async function completeExecution(
  tx: Prisma.TransactionClient,
  executionId: string,
  nodeId: string,
  now: Date,
): Promise<void> {
  await tx.execution.update({
    where: { id: executionId },
    data: { status: 'completed', currentNodeId: nodeId, endedAt: now, failureReason: null },
  });
}

async function failExecution(
  tx: Prisma.TransactionClient,
  context: AdvanceContext,
  reason: string,
  node: JourneyDraftNode | undefined,
): Promise<'failed'> {
  const currentNodeId = context.execution.currentNodeId;
  const existingStep =
    node === undefined
      ? null
      : await tx.executionStep.findUnique({
          where: {
            executionId_nodeId: { executionId: context.execution.id, nodeId: currentNodeId },
          },
          select: { id: true },
        });

  if (node !== undefined) {
    if (existingStep === null) {
      await tx.executionStep.create({
        data: {
          executionId: context.execution.id,
          order: await currentOrder(tx, context.execution.id),
          nodeId: node.id,
          nodeType: node.type,
          status: 'failed',
          output: json({ kind: 'failed', reason }),
          failureReason: reason,
          startedAt: context.now,
          endedAt: context.now,
        },
      });
    } else {
      await tx.executionStep.update({
        where: { id: existingStep.id },
        data: {
          status: 'failed',
          output: json({ kind: 'failed', reason }),
          failureReason: reason,
          endedAt: context.now,
        },
      });
    }
  }

  await tx.execution.update({
    where: { id: context.execution.id },
    data: {
      status: 'failed',
      failureReason: reason,
      endedAt: context.now,
    },
  });
  return 'failed';
}

async function createStep(
  context: AdvanceContext,
  node: JourneyDraftNode,
  status: 'waiting' | 'succeeded',
  output: ExecutionStepOutput,
  deadlineAt: Date | null,
): Promise<void> {
  await context.tx.executionStep.create({
    data: {
      executionId: context.execution.id,
      order: await currentOrder(context.tx, context.execution.id),
      nodeId: node.id,
      nodeType: node.type,
      status,
      output: json(output),
      startedAt: context.now,
      endedAt: status === 'succeeded' ? context.now : null,
      deadlineAt,
    },
  });
}

function entryCandidate(event: EventSummary): EventCandidate {
  return { type: event.type, payload: event.payload };
}

async function evaluateCondition(
  context: AdvanceContext,
  rule: JourneyConditionRule,
): Promise<{ matched: boolean; output: ExecutionStepOutput }> {
  if (rule.kind === 'event_count') {
    const windowStart = new Date(context.now.getTime() - rule.windowSeconds * 1000);
    const candidates = await context.tx.event.findMany({
      where: {
        audienceUserId: context.execution.audienceUserId,
        type: rule.eventType,
        receivedAt: { gte: windowStart, lte: context.now },
      },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, type: true, payload: true },
    });

    const triggerCandidate = entryCandidate(context.triggerEvent);
    let count = 0;
    for (const candidate of candidates) {
      const reason = getEventMatchReason({
        candidate: { type: candidate.type, payload: candidate.payload as Record<string, unknown> },
        expectedType: rule.eventType,
        filter: rule.filter,
        entryEvent: triggerCandidate,
        sameProduct: rule.sameProduct,
      });
      if (reason === undefined) count += 1;
    }

    const matched = compareSegmentValue(count, rule.operator, rule.right);
    return {
      matched,
      output: {
        kind: 'condition',
        rule,
        matched,
        branch: matched ? 'met' : 'unmet',
        evidence: {
          kind: 'event_count',
          evaluatedAt: context.now.toISOString(),
          windowStartAt: windowStart.toISOString(),
          windowEndAt: context.now.toISOString(),
          count,
        },
      },
    };
  }

  const actual =
    rule.left.source === 'user'
      ? readSegmentRuleValue(context.audience, rule.left.path)
      : readEventPayloadValue(entryCandidate(context.triggerEvent), rule.left.path);
  const matched = compareSegmentValue(actual, rule.operator, rule.right);
  return {
    matched,
    output: {
      kind: 'condition',
      rule,
      matched,
      branch: matched ? 'met' : 'unmet',
      evidence: {
        kind: 'value',
        evaluatedAt: context.now.toISOString(),
        actual: toEvidenceValue(actual),
      },
    },
  };
}

async function resolveWaiting(
  context: AdvanceContext,
  node: JourneyDraftNode,
): Promise<'waiting' | 'continue'> {
  const step = await context.tx.executionStep.findUnique({
    where: { executionId_nodeId: { executionId: context.execution.id, nodeId: node.id } },
  });
  if (step === null || step.status !== 'waiting' || step.deadlineAt === null) {
    throw new ExecutionBusinessError('等待步骤记录不完整，无法继续执行');
  }

  if (node.type === 'wait') {
    if (context.now < step.deadlineAt) return 'waiting';
    const next = nextNode(context.definition, node);
    await context.tx.executionStep.update({
      where: { id: step.id },
      data: { status: 'succeeded', endedAt: context.now },
    });
    await updatePointer(context.tx, context.execution.id, 'running', next.id);
    return 'continue';
  }

  if (node.type !== 'wait_for_event') {
    throw new ExecutionBusinessError('等待状态与当前步骤不一致，无法继续执行');
  }

  // 窗口 [等待开始, 截止时间)：截止那一刻收到的事件不算命中。
  const usedEventIds = await context.tx.executionStep.findMany({
    where: {
      executionId: context.execution.id,
      matchedEventId: { not: null },
    },
    select: { matchedEventId: true },
  });
  const excludedEventIds = [
    context.execution.triggerEventId,
    ...usedEventIds.flatMap((stepRecord) =>
      stepRecord.matchedEventId === null ? [] : [stepRecord.matchedEventId],
    ),
  ];

  const candidates = await context.tx.event.findMany({
    where: {
      audienceUserId: context.execution.audienceUserId,
      type: node.eventType,
      receivedAt: { gte: step.startedAt, lt: step.deadlineAt },
      id: { notIn: excludedEventIds },
    },
    // 按接收时间和唯一 ID 稳定排序，取窗口内最早命中的行为。
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, type: true, payload: true },
  });

  const triggerCandidate = entryCandidate(context.triggerEvent);
  const matchedEvent = candidates.find(
    (candidate) =>
      getEventMatchReason({
        candidate: { type: candidate.type, payload: candidate.payload as Record<string, unknown> },
        expectedType: node.eventType,
        filter: node.filter,
        entryEvent: triggerCandidate,
        sameProduct: node.sameProduct,
      }) === undefined,
  );

  if (matchedEvent !== undefined) {
    const next = nextNode(context.definition, node, 'matched');
    await context.tx.executionStep.update({
      where: { id: step.id },
      data: {
        status: 'succeeded',
        endedAt: context.now,
        matchedEventId: matchedEvent.id,
        output: json({
          kind: 'wait_for_event',
          eventType: node.eventType,
          waitSeconds: node.waitSeconds,
          ...(node.filter === undefined ? {} : { filter: node.filter }),
          sameProduct: node.sameProduct,
          outcome: 'matched',
          matchedEventId: matchedEvent.id,
        } satisfies ExecutionStepOutput),
      },
    });
    await updatePointer(context.tx, context.execution.id, 'running', next.id);
    return 'continue';
  }

  // 先查窗口内已提交的匹配行为，再决定是否超时；重启或检查延迟不会漏掉已保存事件。
  if (context.now < step.deadlineAt) return 'waiting';

  const timeoutTarget = nextNode(context.definition, node, 'timeout');
  await context.tx.executionStep.update({
    where: { id: step.id },
    data: {
      status: 'succeeded',
      endedAt: context.now,
      output: json({
        kind: 'wait_for_event',
        eventType: node.eventType,
        waitSeconds: node.waitSeconds,
        ...(node.filter === undefined ? {} : { filter: node.filter }),
        sameProduct: node.sameProduct,
        outcome: 'timeout',
        matchedEventId: null,
      } satisfies ExecutionStepOutput),
    },
  });
  await updatePointer(context.tx, context.execution.id, 'running', timeoutTarget.id);
  return 'continue';
}

async function processNode(
  context: AdvanceContext,
  node: JourneyDraftNode,
): Promise<'continue' | 'waiting' | 'completed'> {
  if (node.type === 'start') {
    const next = nextNode(context.definition, node);
    await createStep(
      context,
      node,
      'succeeded',
      { kind: 'start', entryBehavior: node.entryBehavior },
      null,
    );
    await updatePointer(context.tx, context.execution.id, 'running', next.id);
    return 'continue';
  }

  if (node.type === 'condition') {
    const result = await evaluateCondition(context, node.rules);
    const next = nextNode(context.definition, node, result.matched ? 'met' : 'unmet');
    await createStep(context, node, 'succeeded', result.output, null);
    await updatePointer(context.tx, context.execution.id, 'running', next.id);
    return 'continue';
  }

  if (node.type === 'wait') {
    const deadlineAt = new Date(context.now.getTime() + node.waitSeconds * 1000);
    await createStep(
      context,
      node,
      'waiting',
      { kind: 'wait', waitSeconds: node.waitSeconds },
      deadlineAt,
    );
    await updatePointer(context.tx, context.execution.id, 'waiting', node.id);
    return 'waiting';
  }

  if (node.type === 'wait_for_event') {
    const deadlineAt = new Date(context.now.getTime() + node.waitSeconds * 1000);
    await createStep(
      context,
      node,
      'waiting',
      {
        kind: 'wait_for_event',
        eventType: node.eventType,
        waitSeconds: node.waitSeconds,
        ...(node.filter === undefined ? {} : { filter: node.filter }),
        sameProduct: node.sameProduct,
        outcome: null,
        matchedEventId: null,
      },
      deadlineAt,
    );
    await updatePointer(context.tx, context.execution.id, 'waiting', node.id);
    return 'waiting';
  }

  if (node.type === 'message') {
    const next = nextNode(context.definition, node);
    await createStep(
      context,
      node,
      'succeeded',
      {
        kind: 'message',
        channel: node.channel,
        subject: node.subject,
        body: node.body,
        audienceUserId: context.execution.audienceUserId,
        demo: true,
      },
      null,
    );
    await updatePointer(context.tx, context.execution.id, 'running', next.id);
    return 'continue';
  }

  await createStep(context, node, 'succeeded', { kind: 'end', note: node.note }, null);
  await completeExecution(context.tx, context.execution.id, node.id, context.now);
  return 'completed';
}

async function advanceOneStep(
  prisma: PrismaClient,
  executionId: string,
  readNow: () => Date,
): Promise<'continue' | AdvanceResult> {
  return prisma.$transaction(
    async (tx) => {
      // 锁顺序固定为“活动行 → 执行行”，与停止动作一致，避免两个方向互相等待。
      const located = await tx.execution.findUnique({
        where: { id: executionId },
        select: { campaignId: true },
      });
      if (located === null) return 'missing';
      const campaignStatus = await lockCampaignForExecution(tx, located.campaignId);
      if (campaignStatus === null) return 'missing';

      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "executions" WHERE "id" = ${executionId}::uuid FOR UPDATE
      `;
      if (lockedRows.length === 0) return 'missing';

      const execution = await tx.execution.findUnique({
        where: { id: executionId },
        select: {
          id: true,
          status: true,
          currentNodeId: true,
          audienceUserId: true,
          triggerEventId: true,
          startedAt: true,
          campaign: { select: { goalEventType: true, goalSameProduct: true } },
          journeyVersion: { select: { snapshot: true } },
          audienceUser: { select: { displayName: true, email: true, attributes: true } },
          triggerEvent: {
            select: { id: true, type: true, receivedAt: true, payload: true },
          },
        },
      });
      if (execution === null) return 'missing';

      if (execution.status === 'completed') return 'completed';
      if (execution.status === 'failed') return 'failed';
      if (execution.status === 'stopped') return 'stopped';

      // 目标检查先于指针校验：指针为空但目标已可确认时仍记录达成并退出，
      // 未命中或无目标时才继续原有“指针缺失即失败”的处理。
      if (execution.campaign.goalEventType !== null) {
        const goalEvent = await findGoalEvent(tx, {
          audienceUserId: execution.audienceUserId,
          entryEvent: {
            id: execution.triggerEvent.id,
            type: execution.triggerEvent.type,
            payload: execution.triggerEvent.payload as Record<string, unknown>,
          },
          startedAt: execution.startedAt,
          goal: {
            eventType: execution.campaign.goalEventType,
            sameProduct: execution.campaign.goalSameProduct,
          },
        });
        if (goalEvent !== undefined) {
          // 结束时间在完成目标判断后重新取时，表示实际确认退出的时刻；行为接收时间单独保留。
          await completeExecutionByGoal(tx, { executionId, event: goalEvent, endedAt: readNow() });
          return 'completed';
        }
      }

      // 每步拿到锁并读完运行资料后重新取时，前序步骤耗时和锁等待不占用新步骤的等待时长。
      const now = readNow();
      if (execution.currentNodeId === null) {
        // 没有可执行节点属于运行事实不完整；不伪造失败步骤，只保存执行级原因。
        await tx.execution.update({
          where: { id: execution.id },
          data: { status: 'failed', failureReason: '当前步骤缺失，无法继续执行', endedAt: now },
        });
        return 'failed';
      }

      const snapshot = execution.journeyVersion.snapshot as unknown as JourneyVersionSnapshot;
      const context: AdvanceContext = {
        tx,
        execution: {
          id: execution.id,
          audienceUserId: execution.audienceUserId,
          triggerEventId: execution.triggerEventId,
          currentNodeId: execution.currentNodeId,
          status: execution.status,
        },
        definition: snapshot.definition,
        audience: serializeAudience(execution.audienceUser),
        triggerEvent: triggerEventSummary(execution.triggerEvent),
        now,
      };

      const node = context.definition.nodes.find((item) => item.id === execution.currentNodeId);
      if (node === undefined) {
        await failExecution(tx, context, '当前步骤不存在，无法继续执行', undefined);
        return 'failed';
      }

      try {
        if (execution.status === 'waiting') {
          const result = await resolveWaiting(context, node);
          return result;
        }
        return await processNode(context, node);
      } catch (error) {
        if (error instanceof ExecutionBusinessError) {
          return failExecution(tx, context, error.reason, node);
        }
        throw error;
      }
    },
    { timeout: 15_000 },
  );
}

/**
 * 从当前节点开始连续推进，遇到等待或终态返回。每个节点独立提交，
 * 数据库中的当前节点、步骤和截止时间足以让重启后的推进继续。
 */
export async function advanceExecution(
  prisma: PrismaClient,
  executionId: string,
  now: () => Date = () => new Date(),
): Promise<AdvanceResult> {
  for (;;) {
    const result = await advanceOneStep(prisma, executionId, now);
    if (result !== 'continue') return result;
  }
}
