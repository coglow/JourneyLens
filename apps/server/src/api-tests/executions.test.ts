import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import type { SegmentRule } from '@journeylens/shared';
import { advanceExecution, type AdvanceResult } from '../modules/executions/runner.js';
import { jsonHeaders, makeApp, signedInCookie, type TestApp } from '../test-support/harness.js';
import { startTestDatabase, type TestDatabase } from '../test-support/test-database.js';
import {
  createAudienceUser,
  fullDefinition,
  minimalDefinition,
  publishTestJourney,
} from '../test-support/execution-fixtures.js';

let db: TestDatabase;
let app: TestApp;
let cookie: string;
let clock: Date;

const eligibleExternalId = 'upstream:demo:eligible';
const t0 = new Date('2026-07-30T08:00:00.000Z');

function at(seconds: number): Date {
  return new Date(t0.getTime() + seconds * 1000);
}

async function setupUser(attributes: Record<string, unknown> = { vipLevel: 'gold' }) {
  await createAudienceUser(db, {
    externalId: eligibleExternalId,
    displayName: '霖铃铃',
    email: 'lin@example.com',
    attributes,
  });
}

async function ingestEvent(options: {
  id?: string;
  type?: 'product_viewed' | 'purchase_completed';
  payload?: Record<string, unknown>;
  audienceExternalId?: string;
}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/events/ingest',
    headers: jsonHeaders(cookie),
    payload: {
      id: options.id ?? randomUUID(),
      audienceExternalId: options.audienceExternalId ?? eligibleExternalId,
      type: options.type ?? 'product_viewed',
      payload: options.payload ?? { productId: 'product-1', price: 299 },
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json().data as {
    event: { id: string };
    executions: Array<{ id: string }>;
  };
}

async function startExecution(): Promise<string> {
  const result = await ingestEvent({});
  expect(result.executions).toHaveLength(1);
  return result.executions[0]!.id;
}

async function advance(id: string, seconds: number): Promise<AdvanceResult> {
  clock = at(seconds);
  return advanceExecution(db.prisma, id, () => clock);
}

async function executionWithSteps(id: string) {
  return db.prisma.execution.findUniqueOrThrow({
    where: { id },
    include: { steps: { orderBy: { order: 'asc' } } },
  });
}

function eventCountDefinition(windowSeconds: number) {
  return {
    layoutDirection: 'vertical',
    nodes: [
      {
        id: 'start',
        type: 'start',
        name: '开始',
        position: { x: 0, y: 0 },
        entryBehavior: 'product_viewed',
      },
      {
        id: 'count',
        type: 'condition',
        name: '浏览次数',
        position: { x: 0, y: 100 },
        rules: {
          kind: 'event_count',
          eventType: 'product_viewed',
          windowSeconds,
          sameProduct: false,
          operator: 'gte',
          right: 2,
        },
      },
      {
        id: 'end-met',
        type: 'end',
        name: '满足结束',
        position: { x: -100, y: 200 },
        note: '次数满足',
      },
      {
        id: 'end-unmet',
        type: 'end',
        name: '不满足结束',
        position: { x: 100, y: 200 },
        note: '次数不满足',
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'count' },
      { id: 'e2', source: 'count', target: 'end-met', branch: 'met' },
      { id: 'e3', source: 'count', target: 'end-unmet', branch: 'unmet' },
    ],
  };
}

async function waitForLockWaiters(count: number): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const rows = await db.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS "count"
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query LIKE '%campaigns%'
    `;
    if (Number(rows[0]?.count ?? 0) >= count) return;
    await delay(10);
  }
  throw new Error('等待活动锁竞争超时');
}

async function holdCampaignUpdateLock(campaignId: string) {
  return holdCampaignLock(campaignId, 'UPDATE');
}

async function holdCampaignShareLock(campaignId: string) {
  return holdCampaignLock(campaignId, 'SHARE');
}

async function holdCampaignLock(campaignId: string, mode: 'UPDATE' | 'SHARE') {
  let acquired!: () => void;
  const acquiredPromise = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  let release!: () => void;
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transaction = db.prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "campaigns" WHERE "id" = ${campaignId}::uuid FOR ${Prisma.raw(mode)}
      `;
      acquired();
      await releasePromise;
    },
    { timeout: 20_000, maxWait: 5_000 },
  );
  await acquiredPromise;
  return async () => {
    release();
    await transaction;
  };
}

beforeAll(async () => {
  db = await startTestDatabase();
  clock = t0;
  ({ app } = makeApp(db, false, () => clock));
  cookie = await signedInCookie(app);
});

beforeEach(() => {
  clock = t0;
});

afterEach(async () => {
  await db.reset();
  // reset 会清空会话表，下一个用例重新登录取得有效会话。
  clock = t0;
  cookie = await signedInCookie(app);
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('六类节点推进与等待', () => {
  it('按固定版本走完开始、条件、定时等待、行为等待、消息和结束', async () => {
    await setupUser();
    await publishTestJourney(db, { name: '完整旅程', definition: fullDefinition() });
    const executionId = await startExecution();

    expect(await advance(executionId, 0)).toBe('waiting');
    expect(await advance(executionId, 6)).toBe('waiting');

    clock = at(10);
    const purchase = await ingestEvent({
      type: 'purchase_completed',
      payload: { orderId: 'order-1', productId: 'product-1', amount: 299 },
    });
    expect(purchase.executions).toHaveLength(0);

    expect(await advance(executionId, 12)).toBe('completed');
    const execution = await executionWithSteps(executionId);
    expect(execution.status).toBe('completed');
    expect(execution.currentNodeId).toBe('end-matched');
    expect(execution.endedAt?.toISOString()).toBe(at(12).toISOString());
    expect(execution.steps.map((step) => step.nodeId)).toEqual([
      'start',
      'condition',
      'wait',
      'wait-event',
      'message-matched',
      'end-matched',
    ]);
    expect(execution.steps.map((step) => step.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(execution.steps.every((step) => step.endedAt !== null)).toBe(true);

    const condition = execution.steps[1]!;
    expect(condition.output).toMatchObject({
      kind: 'condition',
      matched: true,
      branch: 'met',
      evidence: { kind: 'value', actual: { exists: true, value: 299 } },
    });
    const wait = execution.steps[2]!;
    expect(wait.deadlineAt?.toISOString()).toBe(at(5).toISOString());
    expect(wait.endedAt?.toISOString()).toBe(at(6).toISOString());
    const waitEvent = execution.steps[3]!;
    expect(waitEvent.startedAt.toISOString()).toBe(at(6).toISOString());
    expect(waitEvent.deadlineAt?.toISOString()).toBe(at(66).toISOString());
    expect(waitEvent.matchedEventId).toBe(purchase.event.id);
    expect(waitEvent.output).toMatchObject({ kind: 'wait_for_event', outcome: 'matched' });
    expect(execution.steps[4]!.output).toMatchObject({
      kind: 'message',
      channel: 'sms',
      body: '感谢购买',
      audienceUserId: execution.audienceUserId,
      demo: true,
    });
    expect(execution.steps[5]!.output).toMatchObject({ kind: 'end', note: '购买分支完成' });
  });

  it('等待到期且没有匹配行为时走超时分支', async () => {
    await setupUser();
    await publishTestJourney(db, { name: '超时旅程', definition: fullDefinition() });
    const executionId = await startExecution();

    expect(await advance(executionId, 0)).toBe('waiting');
    expect(await advance(executionId, 6)).toBe('waiting');
    expect(await advance(executionId, 66)).toBe('completed');

    const execution = await executionWithSteps(executionId);
    expect(execution.currentNodeId).toBe('end-timeout');
    expect(execution.steps.map((step) => step.nodeId)).toEqual([
      'start',
      'condition',
      'wait',
      'wait-event',
      'message-timeout',
      'end-timeout',
    ]);
    expect(execution.steps[3]!.output).toMatchObject({
      kind: 'wait_for_event',
      outcome: 'timeout',
      matchedEventId: null,
    });
    expect(execution.steps[3]!.matchedEventId).toBeNull();
    expect(execution.steps[4]!.output).toMatchObject({ kind: 'message', body: '购买提醒' });
    expect(execution.steps[5]!.output).toMatchObject({ kind: 'end', note: '超时分支完成' });
  });

  it('条件不满足时走另一分支，并保存实际值', async () => {
    await setupUser();
    await publishTestJourney(db, { name: '低价旅程', definition: fullDefinition() });
    const result = await ingestEvent({
      payload: { productId: 'product-1', price: 50 },
    });
    const executionId = result.executions[0]!.id;

    expect(await advance(executionId, 0)).toBe('completed');
    const execution = await executionWithSteps(executionId);
    expect(execution.steps.map((step) => step.nodeId)).toEqual([
      'start',
      'condition',
      'message-unmet',
      'end-unmet',
    ]);
    expect(execution.steps[1]!.output).toMatchObject({
      kind: 'condition',
      matched: false,
      branch: 'unmet',
      evidence: { kind: 'value', actual: { exists: true, value: 50 } },
    });
  });

  it('定时等待到期前不推进，截止时间不重新计算', async () => {
    await setupUser();
    await publishTestJourney(db, { name: '计时旅程', definition: fullDefinition() });
    const executionId = await startExecution();

    expect(await advance(executionId, 0)).toBe('waiting');
    const first = await executionWithSteps(executionId);
    const waitStep = first.steps.find((step) => step.nodeId === 'wait')!;
    expect(waitStep.deadlineAt?.toISOString()).toBe(at(5).toISOString());

    expect(await advance(executionId, 4)).toBe('waiting');
    const stillWaiting = await executionWithSteps(executionId);
    expect(stillWaiting.steps).toHaveLength(3);
    expect(stillWaiting.steps[2]!.deadlineAt?.toISOString()).toBe(at(5).toISOString());
    expect(stillWaiting.status).toBe('waiting');

    expect(await advance(executionId, 5)).toBe('waiting');
    const advanced = await executionWithSteps(executionId);
    expect(advanced.steps[2]!.status).toBe('succeeded');
    expect(advanced.steps[3]!.nodeId).toBe('wait-event');
  });

  it('每步取得锁后重新读取时间，前序耗时不提前消耗新等待时长', async () => {
    await setupUser();
    const journey = await publishTestJourney(db, {
      name: '逐步计时旅程',
      definition: fullDefinition(),
    });
    const executionId = await startExecution();
    const readNow = vi
      .fn()
      .mockReturnValueOnce(at(10))
      .mockReturnValueOnce(at(12))
      .mockReturnValue(at(14));

    const release = await holdCampaignUpdateLock(journey.campaignId);
    const advancing = advanceExecution(db.prisma, executionId, readNow);
    try {
      await waitForLockWaiters(1);
      expect(readNow).not.toHaveBeenCalled();
    } finally {
      await release();
    }
    expect(await advancing).toBe('waiting');

    const execution = await executionWithSteps(executionId);
    expect(execution.steps[0]!.startedAt.toISOString()).toBe(at(10).toISOString());
    expect(execution.steps[1]!.startedAt.toISOString()).toBe(at(12).toISOString());
    expect(execution.steps[2]!.startedAt.toISOString()).toBe(at(14).toISOString());
    expect(execution.steps[2]!.deadlineAt?.toISOString()).toBe(at(19).toISOString());
    expect(execution.steps[2]!.endedAt).toBeNull();
    expect(await advance(executionId, 18)).toBe('waiting');
    expect(await advance(executionId, 19)).toBe('waiting');
    const advanced = await executionWithSteps(executionId);
    expect(advanced.steps[2]!.status).toBe('succeeded');
    expect(advanced.steps[3]!.nodeId).toBe('wait-event');
  });

  it('行为等待窗口包含起点、排除截止时刻', async () => {
    await setupUser();
    await publishTestJourney(db, { name: '窗口旅程', definition: fullDefinition() });
    const executionId = await startExecution();
    expect(await advance(executionId, 0)).toBe('waiting');
    expect(await advance(executionId, 6)).toBe('waiting');

    // 等待从第 6 秒开始，同一时刻保存的行为可以唤醒等待。
    clock = at(6);
    const boundary = await ingestEvent({
      type: 'purchase_completed',
      payload: { orderId: 'order-1', productId: 'product-1', amount: 299 },
    });
    expect(await advance(executionId, 6)).toBe('completed');
    const matched = await executionWithSteps(executionId);
    expect(matched.steps[3]!.matchedEventId).toBe(boundary.event.id);

    // 另一条执行在截止时刻收到购买行为：截止时刻不计入，应走超时。
    const secondId = await startExecution();
    expect(await advance(secondId, 100)).toBe('waiting');
    expect(await advance(secondId, 106)).toBe('waiting');
    clock = at(166);
    const late = await ingestEvent({
      type: 'purchase_completed',
      payload: { orderId: 'order-2', productId: 'product-1', amount: 299 },
    });
    expect(await advance(secondId, 166)).toBe('completed');
    const timeout = await executionWithSteps(secondId);
    expect(timeout.steps[3]!.matchedEventId).toBeNull();
    expect(timeout.steps[3]!.output).toMatchObject({ kind: 'wait_for_event', outcome: 'timeout' });
    // 事件本身仍然保存，只是没有进入等待窗口。
    expect(await db.prisma.event.count({ where: { id: late.event.id } })).toBe(1);
  });

  it('同商品判断要求双方都有商品 ID 且相等', async () => {
    await setupUser();
    await publishTestJourney(db, { name: '同商品旅程', definition: fullDefinition() });
    const executionId = await startExecution();
    expect(await advance(executionId, 0)).toBe('waiting');
    expect(await advance(executionId, 6)).toBe('waiting');

    clock = at(10);
    await ingestEvent({
      type: 'purchase_completed',
      payload: { orderId: 'order-other', productId: 'product-2', amount: 299 },
    });
    expect(await advance(executionId, 66)).toBe('completed');
    const timeout = await executionWithSteps(executionId);
    expect(timeout.steps[3]!.output).toMatchObject({ kind: 'wait_for_event', outcome: 'timeout' });

    const secondId = await startExecution();
    expect(await advance(secondId, 100)).toBe('waiting');
    expect(await advance(secondId, 106)).toBe('waiting');
    clock = at(110);
    await ingestEvent({
      type: 'purchase_completed',
      payload: { orderId: 'order-missing-product', amount: 299 },
    });
    expect(await advance(secondId, 166)).toBe('completed');
    const missing = await executionWithSteps(secondId);
    expect(missing.steps[3]!.output).toMatchObject({ kind: 'wait_for_event', outcome: 'timeout' });
  });

  it('同一条行为在同一执行中最多唤醒一个等待节点', async () => {
    await setupUser();
    const definition = {
      layoutDirection: 'vertical',
      nodes: [
        {
          id: 'start',
          type: 'start',
          name: '开始',
          position: { x: 0, y: 0 },
          entryBehavior: 'product_viewed',
        },
        {
          id: 'first-wait',
          type: 'wait_for_event',
          name: '第一次等待',
          position: { x: 0, y: 100 },
          eventType: 'purchase_completed',
          waitSeconds: 60,
          sameProduct: true,
        },
        {
          id: 'second-wait',
          type: 'wait_for_event',
          name: '第二次等待',
          position: { x: 0, y: 200 },
          eventType: 'purchase_completed',
          waitSeconds: 1,
          sameProduct: true,
        },
        {
          id: 'end-first-timeout',
          type: 'end',
          name: '第一次超时',
          position: { x: -200, y: 200 },
          note: '第一次等待超时',
        },
        {
          id: 'end-second-timeout',
          type: 'end',
          name: '第二次超时',
          position: { x: 200, y: 300 },
          note: '第二次等待超时',
        },
        {
          id: 'message',
          type: 'message',
          name: '匹配消息',
          position: { x: 0, y: 300 },
          channel: 'sms',
          subject: null,
          body: '匹配成功',
        },
        {
          id: 'end-matched',
          type: 'end',
          name: '匹配结束',
          position: { x: 0, y: 400 },
          note: '匹配结束',
        },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'first-wait' },
        { id: 'e2', source: 'first-wait', target: 'second-wait', branch: 'matched' },
        { id: 'e3', source: 'first-wait', target: 'end-first-timeout', branch: 'timeout' },
        { id: 'e4', source: 'second-wait', target: 'message', branch: 'matched' },
        { id: 'e5', source: 'second-wait', target: 'end-second-timeout', branch: 'timeout' },
        { id: 'e6', source: 'message', target: 'end-matched' },
      ],
    };
    await publishTestJourney(db, { name: '单次唤醒旅程', definition });
    const executionId = await startExecution();

    expect(await advance(executionId, 0)).toBe('waiting');
    clock = at(5);
    const purchase = await ingestEvent({
      type: 'purchase_completed',
      payload: { orderId: 'order-1', productId: 'product-1', amount: 299 },
    });
    // 处理时刻与行为接收时刻相同：第二次等待的窗口会包含这条行为，但同一执行不能再次使用它。
    expect(await advance(executionId, 5)).toBe('waiting');
    expect(await advance(executionId, 8)).toBe('completed');

    const execution = await executionWithSteps(executionId);
    expect(execution.steps.find((step) => step.nodeId === 'first-wait')!.matchedEventId).toBe(
      purchase.event.id,
    );
    expect(
      execution.steps.find((step) => step.nodeId === 'second-wait')!.matchedEventId,
    ).toBeNull();
    expect(execution.currentNodeId).toBe('end-second-timeout');
  });
});

describe('条件证据与资料读取时机', () => {
  it('次数条件按窗口内已保存行为计数，并包含进入行为本身', async () => {
    await setupUser();
    await publishTestJourney(db, { name: '次数旅程', definition: eventCountDefinition(30) });

    clock = at(0);
    await ingestEvent({});
    clock = at(1);
    const second = await ingestEvent({});
    const executionId = second.executions[0]!.id;

    expect(await advance(executionId, 2)).toBe('completed');
    const execution = await executionWithSteps(executionId);
    const condition = execution.steps.find((step) => step.nodeType === 'condition')!;
    expect(condition.output).toMatchObject({
      kind: 'condition',
      matched: true,
      evidence: {
        kind: 'event_count',
        count: 2,
        windowStartAt: at(-28).toISOString(),
        windowEndAt: at(2).toISOString(),
      },
    });
    expect(execution.currentNodeId).toBe('end-met');
  });

  it('次数窗口包含起始和结束两端', async () => {
    await setupUser();
    await publishTestJourney(db, { name: '次数边界旅程', definition: eventCountDefinition(5) });

    clock = at(5);
    await ingestEvent({});
    clock = at(10);
    const second = await ingestEvent({});
    const executionId = second.executions[0]!.id;

    expect(await advance(executionId, 10)).toBe('completed');
    const execution = await executionWithSteps(executionId);
    expect(execution.steps.find((step) => step.nodeType === 'condition')!.output).toMatchObject({
      kind: 'condition',
      matched: true,
      evidence: {
        kind: 'event_count',
        count: 2,
        windowStartAt: at(5).toISOString(),
        windowEndAt: at(10).toISOString(),
      },
    });
  });

  it('用户属性条件读取节点执行时的资料，而不是进入时的快照', async () => {
    await setupUser({ vipLevel: 'gold' });
    const rules: SegmentRule = {
      kind: 'compare',
      left: { source: 'user', path: 'vipLevel' },
      operator: 'in',
      right: ['gold'],
    };
    const definition = {
      layoutDirection: 'vertical',
      nodes: [
        {
          id: 'start',
          type: 'start',
          name: '开始',
          position: { x: 0, y: 0 },
          entryBehavior: 'product_viewed',
        },
        {
          id: 'check',
          type: 'condition',
          name: '会员判断',
          position: { x: 0, y: 100 },
          rules,
        },
        {
          id: 'end-met',
          type: 'end',
          name: '满足结束',
          position: { x: -100, y: 200 },
          note: '仍为黄金会员',
        },
        {
          id: 'end-unmet',
          type: 'end',
          name: '不满足结束',
          position: { x: 100, y: 200 },
          note: '已不是黄金会员',
        },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'check' },
        { id: 'e2', source: 'check', target: 'end-met', branch: 'met' },
        { id: 'e3', source: 'check', target: 'end-unmet', branch: 'unmet' },
      ],
    };
    await publishTestJourney(db, { name: '资料时机旅程', definition });
    const executionId = await startExecution();

    await db.prisma.audienceUser.update({
      where: { externalId: eligibleExternalId },
      data: { attributes: { vipLevel: 'silver' } },
    });

    expect(await advance(executionId, 1)).toBe('completed');
    const execution = await executionWithSteps(executionId);
    expect(execution.steps.find((step) => step.nodeType === 'condition')!.output).toMatchObject({
      kind: 'condition',
      matched: false,
      evidence: { kind: 'value', actual: { exists: true, value: 'silver' } },
    });
  });

  it('进入行为属性固定读取触发行为，不被后续同类型行为替代', async () => {
    await setupUser();
    await publishTestJourney(db, { name: '进入属性旅程', definition: fullDefinition() });
    const executionId = await startExecution();

    // 另一条浏览行为价格较低，但不影响第一条执行的进入属性。
    clock = at(1);
    await ingestEvent({ payload: { productId: 'product-2', price: 50 } });

    expect(await advance(executionId, 2)).toBe('waiting');
    const execution = await executionWithSteps(executionId);
    expect(execution.steps.find((step) => step.nodeType === 'condition')!.output).toMatchObject({
      kind: 'condition',
      matched: true,
      evidence: { kind: 'value', actual: { exists: true, value: 299 } },
    });
  });
});

describe('重启恢复、停止与失败', () => {
  it('等待中重启后保留原截止时间并继续，不重复写步骤或消息', async () => {
    await setupUser();
    await publishTestJourney(db, { name: '重启旅程', definition: fullDefinition() });
    const executionId = await startExecution();
    expect(await advance(executionId, 0)).toBe('waiting');

    const restarted = new PrismaClient({ datasourceUrl: db.connectionUri });
    try {
      expect(await advanceExecution(restarted, executionId, () => at(6))).toBe('waiting');
      const afterRestart = await executionWithSteps(executionId);
      expect(afterRestart.steps[2]!.deadlineAt?.toISOString()).toBe(at(5).toISOString());
      expect(afterRestart.steps[3]!.deadlineAt?.toISOString()).toBe(at(66).toISOString());
    } finally {
      await restarted.$disconnect();
    }

    clock = at(66);
    expect(await advance(executionId, 66)).toBe('completed');
    const completed = await executionWithSteps(executionId);
    const messageCount = completed.steps.filter((step) => step.nodeType === 'message').length;
    expect(messageCount).toBe(1);

    const restartedAgain = new PrismaClient({ datasourceUrl: db.connectionUri });
    try {
      expect(await advanceExecution(restartedAgain, executionId, () => at(70))).toBe('completed');
      const unchanged = await executionWithSteps(executionId);
      expect(unchanged.steps).toHaveLength(completed.steps.length);
    } finally {
      await restartedAgain.$disconnect();
    }
  });

  it('停止活动会终止未结束执行，已完成记录和消息保留', async () => {
    await setupUser();
    const journey = await publishTestJourney(db, {
      name: '停止旅程',
      definition: fullDefinition({ waitSeconds: 1, eventWaitSeconds: 1 }),
    });

    // 先完成一条执行，再让另一条停在定时等待中。
    const completedId = await startExecution();
    clock = at(0);
    expect(await advance(completedId, 0)).toBe('waiting');
    expect(await advance(completedId, 2)).toBe('waiting');
    expect(await advance(completedId, 4)).toBe('completed');
    const completedBefore = await executionWithSteps(completedId);

    const waitingId = await startExecution();
    expect(await advance(waitingId, 5)).toBe('waiting');

    clock = at(6);
    const stopResponse = await app.inject({
      method: 'POST',
      url: `/api/campaigns/${journey.campaignId}/stop`,
      headers: jsonHeaders(cookie),
      payload: {},
    });
    expect(stopResponse.statusCode).toBe(200);

    const stopped = await executionWithSteps(waitingId);
    expect(stopped.status).toBe('stopped');
    expect(stopped.endedAt?.toISOString()).toBe(at(6).toISOString());
    expect(stopped.steps.find((step) => step.nodeId === 'wait')?.status).toBe('stopped');

    expect(await advance(waitingId, 10)).toBe('stopped');
    const unchangedWaiting = await executionWithSteps(waitingId);
    expect(unchangedWaiting.steps).toHaveLength(stopped.steps.length);

    const completedAfter = await executionWithSteps(completedId);
    expect(completedAfter.status).toBe('completed');
    expect(completedAfter.steps).toHaveLength(completedBefore.steps.length);
  });

  it('流程缺少下一步时保存失败步骤和执行级原因', async () => {
    await setupUser();
    const definition = {
      layoutDirection: 'vertical',
      nodes: [
        {
          id: 'start',
          type: 'start',
          name: '开始',
          position: { x: 0, y: 0 },
          entryBehavior: 'product_viewed',
        },
      ],
      edges: [],
    };
    await publishTestJourney(db, { name: '失败旅程', definition });
    const executionId = await startExecution();

    expect(await advance(executionId, 0)).toBe('failed');
    const execution = await executionWithSteps(executionId);
    expect(execution.status).toBe('failed');
    expect(execution.failureReason).toContain('流程缺少下一步');
    expect(execution.steps).toHaveLength(1);
    expect(execution.steps[0]!.status).toBe('failed');
    expect(execution.steps[0]!.output).toMatchObject({ kind: 'failed' });
  });
});

describe('执行记录查询与轨迹读取', () => {
  async function listExecutions(query: Record<string, string | number>) {
    const params = new URLSearchParams(
      Object.entries(query).map(([key, value]): [string, string] => [key, String(value)]),
    );
    return app.inject({
      method: 'GET',
      url: `/api/executions?${params.toString()}`,
      headers: { host: 'localhost', cookie },
    });
  }

  it('按条件分页查询，并读取实际保存的步骤轨迹', async () => {
    await setupUser();
    const journey = await publishTestJourney(db, {
      name: '查询旅程',
      definition: fullDefinition({ waitSeconds: 1, eventWaitSeconds: 1 }),
    });

    const completedId = await startExecution();
    expect(await advance(completedId, 0)).toBe('waiting');
    expect(await advance(completedId, 2)).toBe('waiting');
    expect(await advance(completedId, 3)).toBe('completed');

    clock = at(5);
    const waitingId = await startExecution();
    expect(await advance(waitingId, 5)).toBe('waiting');

    const waiting = await listExecutions({ status: 'waiting', campaignId: journey.campaignId });
    expect(waiting.statusCode).toBe(200);
    const waitingBody = waiting.json();
    expect(waitingBody.page).toEqual({ page: 1, pageSize: 10, total: 1 });
    expect(waitingBody.data[0]).toMatchObject({
      id: waitingId,
      status: 'waiting',
      audience: { externalId: eligibleExternalId, displayName: '霖铃铃' },
      campaign: { id: journey.campaignId },
      journey: { id: journey.journeyId },
      version: { id: journey.versionId, versionNumber: 1 },
      currentStep: { nodeId: 'wait', name: '定时等待', nodeType: 'wait' },
      result: null,
    });

    const byKeyword = await listExecutions({ q: '霖铃铃' });
    expect(byKeyword.json().page.total).toBe(2);

    const ended = await listExecutions({ endedFrom: at(0).toISOString() });
    expect(ended.json().page.total).toBe(1);
    expect(ended.json().data[0].id).toBe(completedId);
    expect(ended.json().data[0].result).toBe('超时分支完成');

    const invalidPageSize = await listExecutions({ pageSize: 15 });
    expect(invalidPageSize.statusCode).toBe(400);
    expect(invalidPageSize.json().error.message).toContain('每页条数只能选择 10、20 或 50 条');

    const invalidRange = await listExecutions({
      createdFrom: at(10).toISOString(),
      createdTo: at(0).toISOString(),
    });
    expect(invalidRange.statusCode).toBe(400);
    expect(invalidRange.json().error.message).toContain('时间范围无效');

    const trace = await app.inject({
      method: 'GET',
      url: `/api/executions/${completedId}/trace`,
      headers: { host: 'localhost', cookie },
    });
    expect(trace.statusCode).toBe(200);
    const traceBody = trace.json().data;
    expect(traceBody).toMatchObject({
      id: completedId,
      status: 'completed',
      campaign: { id: journey.campaignId, name: '测试活动 查询旅程' },
      journey: { id: journey.journeyId, name: '查询旅程' },
      version: { id: journey.versionId, versionNumber: 1 },
      audience: {
        externalId: eligibleExternalId,
        displayName: '霖铃铃',
      },
      entryEvidence: { segment: null, values: [] },
      triggerEvent: { type: 'product_viewed' },
      failureReason: null,
    });
    expect(traceBody.audience).toEqual({ externalId: eligibleExternalId, displayName: '霖铃铃' });
    expect(traceBody).not.toHaveProperty('entrySnapshot');
    expect(trace.body).not.toContain('lin@example.com');
    expect(traceBody.steps.map((step: { nodeId: string }) => step.nodeId)).toEqual([
      'start',
      'condition',
      'wait',
      'wait-event',
      'message-timeout',
      'end-timeout',
    ]);
    expect(
      traceBody.steps.find((step: { nodeType: string }) => step.nodeType === 'message'),
    ).toMatchObject({
      output: { kind: 'message', channel: 'push', body: '购买提醒', demo: true },
    });

    const missing = await app.inject({
      method: 'GET',
      url: `/api/executions/${randomUUID()}/trace`,
      headers: { host: 'localhost', cookie },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('入口仅返回固定规则引用的历史值，排除无关资料并保留缺失语义', async () => {
    await setupUser({
      vipLevel: 'gold',
      city: '上海',
      occupation: 'office',
      age: 32,
      totalSpend: 5680.5,
    });
    const rules: SegmentRule = {
      kind: 'all',
      children: [
        {
          kind: 'compare',
          left: { source: 'user', path: 'vipLevel' },
          operator: 'in',
          right: ['gold'],
        },
        {
          kind: 'any',
          children: [
            {
              kind: 'compare',
              left: { source: 'user', path: 'city' },
              operator: 'in',
              right: ['上海'],
            },
            {
              kind: 'not',
              child: {
                kind: 'compare',
                left: { source: 'user', path: 'occupation' },
                operator: 'in',
                right: ['student'],
              },
            },
          ],
        },
        {
          kind: 'not',
          child: {
            kind: 'compare',
            left: { source: 'user', path: 'lastActiveDaysAgo' },
            operator: 'exists',
          },
        },
      ],
    };
    const journey = await publishTestJourney(db, {
      name: '入口证据',
      definition: minimalDefinition(),
      entrySegment: { name: '固定入口人群', rules },
    });
    const id = await startExecution();
    await db.prisma.audienceUser.update({
      where: { externalId: eligibleExternalId },
      data: {
        email: 'changed@example.com',
        attributes: { vipLevel: 'normal', city: '北京', age: 66 },
      },
    });
    await db.prisma.segment.update({
      where: { id: journey.segmentId! },
      data: {
        rules: {
          kind: 'compare',
          left: { source: 'user', path: 'age' },
          operator: 'gte',
          right: 60,
        },
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/executions/${id}/trace`,
      headers: { host: 'localhost', cookie },
    });
    expect(response.statusCode).toBe(200);
    const trace = response.json().data;
    expect(trace.entryEvidence).toEqual({
      segment: { name: '固定入口人群', rules },
      values: [
        { field: 'vipLevel', actual: { exists: true, value: 'gold' } },
        { field: 'city', actual: { exists: true, value: '上海' } },
        { field: 'occupation', actual: { exists: true, value: 'office' } },
        { field: 'lastActiveDaysAgo', actual: { exists: false } },
      ],
    });
    expect(trace.audience).toEqual({ externalId: eligibleExternalId, displayName: '霖铃铃' });
    expect(trace).not.toHaveProperty('entrySnapshot');
    expect(response.body).not.toContain('lin@example.com');
    expect(response.body).not.toContain('changed@example.com');
    expect(response.body).not.toContain('totalSpend');
    expect(response.body).not.toContain('"age"');
  });
});

describe('活动锁竞争顺序', () => {
  it('暂停先取得排他锁时，后到的行为不创建执行', async () => {
    await setupUser();
    const journey = await publishTestJourney(db, {
      name: '暂停竞争旅程',
      definition: minimalDefinition(),
    });

    const release = await holdCampaignUpdateLock(journey.campaignId);
    const pausePromise = app.inject({
      method: 'POST',
      url: `/api/campaigns/${journey.campaignId}/pause`,
      headers: jsonHeaders(cookie),
      payload: {},
    });
    await waitForLockWaiters(1);

    const ingestPromise = app.inject({
      method: 'POST',
      url: '/api/events/ingest',
      headers: jsonHeaders(cookie),
      payload: {
        id: randomUUID(),
        audienceExternalId: eligibleExternalId,
        type: 'product_viewed',
        payload: { productId: 'product-1' },
      },
    });
    await waitForLockWaiters(2);
    await release();

    const [pauseResponse, ingestResponse] = await Promise.all([pausePromise, ingestPromise]);
    expect(pauseResponse.statusCode).toBe(200);
    expect(ingestResponse.statusCode).toBe(201);
    expect(ingestResponse.json().data.executions).toEqual([]);
    expect(await db.prisma.event.count()).toBe(1);
    expect(await db.prisma.execution.count()).toBe(0);
  });

  it('行为先取得共享锁时先提交执行，随后的停止终止该执行', async () => {
    await setupUser();
    const journey = await publishTestJourney(db, {
      name: '停止竞争旅程',
      definition: minimalDefinition(),
    });

    // 手工持有共享锁，模拟行为事务先完成入口判断和执行提交；停止动作会等待共享锁释放。
    const release = await holdCampaignShareLock(journey.campaignId);
    const ingestResponse = await ingestEvent({});
    expect(ingestResponse.executions).toHaveLength(1);

    const stopPromise = app.inject({
      method: 'POST',
      url: `/api/campaigns/${journey.campaignId}/stop`,
      headers: jsonHeaders(cookie),
      payload: {},
    });
    await waitForLockWaiters(1);
    await release();
    expect((await stopPromise).statusCode).toBe(200);

    const execution = await db.prisma.execution.findUniqueOrThrow({
      where: { id: ingestResponse.executions[0]!.id },
    });
    expect(execution.status).toBe('stopped');
  });
});
