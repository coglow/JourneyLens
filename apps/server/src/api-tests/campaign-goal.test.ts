import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { journeyDraftDefinitionSchema, type JourneyDraftDefinition } from '@journeylens/shared';
import { advanceExecution, type AdvanceResult } from '../modules/executions/runner.js';
import { jsonHeaders, makeApp, signedInCookie, type TestApp } from '../test-support/harness.js';
import {
  startTestDatabase,
  testAccountId,
  type TestDatabase,
} from '../test-support/test-database.js';
import {
  createAudienceUser,
  publishTestJourney,
  type TestJourney,
} from '../test-support/execution-fixtures.js';

let db: TestDatabase;
let app: TestApp;
let cookie: string;
let clock: Date;

const externalId = 'upstream:goal:user';
const t0 = new Date('2026-08-04T08:00:00.000Z');

function at(seconds: number): Date {
  return new Date(t0.getTime() + seconds * 1000);
}

/** 开始 → 定时等待 → 消息 → 结束：用于验证目标退出时后续节点不执行。 */
function waitDefinition(entryBehavior = 'product_viewed'): JourneyDraftDefinition {
  return journeyDraftDefinitionSchema.parse({
    layoutDirection: 'vertical',
    nodes: [
      {
        id: 'start',
        type: 'start',
        name: '开始',
        position: { x: 0, y: 0 },
        entryBehavior,
      },
      { id: 'wait', type: 'wait', name: '等待 60 秒', position: { x: 0, y: 100 }, waitSeconds: 60 },
      {
        id: 'message',
        type: 'message',
        name: '购买提醒',
        position: { x: 0, y: 200 },
        channel: 'sms',
        subject: null,
        body: '购买提醒',
      },
      { id: 'end', type: 'end', name: '结束', position: { x: 0, y: 300 }, note: '流程结束' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'wait' },
      { id: 'e2', source: 'wait', target: 'message' },
      { id: 'e3', source: 'message', target: 'end' },
    ],
  });
}

/** 开始 → 等待购买 → 购买感谢 → 结束：用于验证目标先于等待匹配。 */
function waitForPurchaseDefinition(): JourneyDraftDefinition {
  return journeyDraftDefinitionSchema.parse({
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
        id: 'wait-purchase',
        type: 'wait_for_event',
        name: '等待同商品购买',
        position: { x: 0, y: 100 },
        eventType: 'purchase_completed',
        waitSeconds: 600,
        sameProduct: true,
      },
      {
        id: 'message',
        type: 'message',
        name: '购买感谢',
        position: { x: 0, y: 200 },
        channel: 'sms',
        subject: null,
        body: '感谢购买',
      },
      { id: 'end', type: 'end', name: '结束', position: { x: 0, y: 300 }, note: '流程结束' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'wait-purchase' },
      { id: 'e2', source: 'wait-purchase', target: 'message', branch: 'matched' },
      { id: 'e3', source: 'wait-purchase', target: 'end', branch: 'timeout' },
      { id: 'e4', source: 'message', target: 'end' },
    ],
  });
}

async function setupUser(): Promise<void> {
  await createAudienceUser(db, {
    externalId,
    displayName: '目标验收用户',
    email: 'goal@example.com',
    attributes: {},
  });
}

async function ingestEvent(options: {
  type?: 'product_viewed' | 'purchase_completed' | 'reservation_created';
  payload?: Record<string, unknown>;
  id?: string;
  expectedStatus?: number;
}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/events/ingest',
    headers: jsonHeaders(cookie),
    payload: {
      id: options.id ?? randomUUID(),
      audienceExternalId: externalId,
      type: options.type ?? 'product_viewed',
      payload: options.payload ?? { productId: 'product-A' },
    },
  });
  expect(response.statusCode).toBe(options.expectedStatus ?? 201);
  return response.json().data as {
    event: { id: string; receivedAt: string };
    executions: Array<{ id: string }>;
    duplicate: boolean;
  };
}

async function advance(id: string, seconds: number): Promise<AdvanceResult> {
  clock = at(seconds);
  return advanceExecution(db.prisma, id, () => clock);
}

async function execution(id: string) {
  return db.prisma.execution.findUniqueOrThrow({
    where: { id },
    include: { steps: { orderBy: { order: 'asc' } }, goalEvent: true },
  });
}

async function createCampaignViaApi(body: unknown) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/campaigns',
    headers: jsonHeaders(cookie),
    payload: JSON.stringify(body),
  });
  return response;
}

function getCampaign(id: string) {
  return app.inject({ method: 'GET', url: `/api/campaigns/${id}`, headers: { cookie } });
}

function patchCampaign(id: string, body: unknown) {
  return app.inject({
    method: 'PATCH',
    url: `/api/campaigns/${id}`,
    headers: jsonHeaders(cookie),
    payload: JSON.stringify(body),
  });
}

function getOverview(id: string) {
  return app.inject({ method: 'GET', url: `/api/campaigns/${id}/overview`, headers: { cookie } });
}

/** 通过路线发布时只需要修订号；这里直接写入已保存的草稿。 */
async function seedJourneyForPublish(input: {
  campaignId: string;
  name: string;
  definition: JourneyDraftDefinition;
}) {
  return db.prisma.journey.create({
    data: {
      campaignId: input.campaignId,
      name: input.name,
      draftDefinition: input.definition as unknown as Prisma.InputJsonValue,
      createdById: testAccountId,
      updatedById: testAccountId,
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  db = await startTestDatabase();
});

beforeEach(async () => {
  await db.reset();
  clock = t0;
  app = makeApp(db, false, () => clock).app;
  cookie = await signedInCookie(app);
  await setupUser();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('活动目标配置', () => {
  it('创建时保存目标与同商品选项，详情返回可编辑标记', async () => {
    const created = await createCampaignViaApi({
      name: '目标活动',
      goal: { eventType: 'purchase_completed', sameProduct: true },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      goal: { eventType: 'purchase_completed', sameProduct: true },
      goalEditable: true,
    });

    const detail = await getCampaign(created.json().data.id as string);
    expect(detail.json().data.goal).toEqual({ eventType: 'purchase_completed', sameProduct: true });

    const noGoal = await createCampaignViaApi({ name: '无目标活动' });
    expect(noGoal.json().data).toMatchObject({ goal: null, goalEditable: true });
  });

  it('拒绝非法目标类型和非法同商品组合', async () => {
    const illegalType = await createCampaignViaApi({
      name: '非法目标',
      goal: { eventType: 'product_viewed', sameProduct: false },
    });
    expect(illegalType.statusCode).toBe(400);
    expect(illegalType.json().error.message).toBe(
      '目标只能选择完成购买、创建预约、完成注册或开通订阅',
    );

    const illegalProduct = await createCampaignViaApi({
      name: '非法同商品',
      goal: { eventType: 'registration_completed', sameProduct: true },
    });
    expect(illegalProduct.statusCode).toBe(400);
    expect(illegalProduct.json().error.message).toBe('只有完成购买和创建预约可以要求同一商品');
    expect(await db.prisma.campaign.count()).toBe(0);
  });

  it('数据库拒绝无目标却开启同商品，合法配置仍能保存', async () => {
    await expect(
      db.prisma.campaign.create({
        data: {
          name: '无目标却开启同商品',
          goalEventType: null,
          goalSameProduct: true,
          createdById: testAccountId,
        },
      }),
    ).rejects.toThrow('campaigns_goal_same_product_check');

    await db.prisma.campaign.createMany({
      data: [
        {
          name: '无目标',
          goalEventType: null,
          goalSameProduct: false,
          createdById: testAccountId,
        },
        {
          name: '同商品购买',
          goalEventType: 'purchase_completed',
          goalSameProduct: true,
          createdById: testAccountId,
        },
        {
          name: '同商品预约',
          goalEventType: 'reservation_created',
          goalSameProduct: true,
          createdById: testAccountId,
        },
      ],
    });
    expect(await db.prisma.campaign.count()).toBe(3);
  });

  it('发布前可修改目标，首次发布后目标固定但其他资料仍可编辑', async () => {
    const created = await createCampaignViaApi({ name: '目标固定活动' });
    const campaignId = created.json().data.id as string;

    const changed = await patchCampaign(campaignId, {
      goal: { eventType: 'reservation_created', sameProduct: true },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().data.goal).toEqual({
      eventType: 'reservation_created',
      sameProduct: true,
    });

    await seedJourneyForPublish({
      campaignId,
      name: '已发布旅程',
      definition: waitDefinition(),
    });
    const journey = await db.prisma.journey.findFirstOrThrow({ where: { campaignId } });
    await db.prisma.journeyVersion.create({
      data: {
        journeyId: journey.id,
        versionNumber: 1,
        sourceRevision: 1,
        snapshot: { name: '已发布旅程', description: null, entrySegment: null, definition: {} },
        publishedById: testAccountId,
        publishedAt: t0,
      },
    });

    const detail = await getCampaign(campaignId);
    expect(detail.json().data.goalEditable).toBe(false);

    const rejected = await patchCampaign(campaignId, {
      goal: { eventType: 'purchase_completed', sameProduct: false },
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.message).toBe('活动已有发布旅程，目标不能修改');

    const cleared = await patchCampaign(campaignId, { goal: null });
    expect(cleared.statusCode).toBe(409);

    const renamed = await patchCampaign(campaignId, { name: '改名后的活动' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().data.name).toBe('改名后的活动');
    expect(renamed.json().data.goal).toEqual({
      eventType: 'reservation_created',
      sameProduct: true,
    });
  });

  it('暂停后目标仍固定，其他资料按原规则可编辑', async () => {
    const created = await createCampaignViaApi({
      name: '暂停活动',
      goal: { eventType: 'purchase_completed', sameProduct: false },
    });
    const campaignId = created.json().data.id as string;
    await db.prisma.journey.create({
      data: {
        campaignId,
        name: '暂停旅程',
        createdById: testAccountId,
        updatedById: testAccountId,
      },
    });
    await db.prisma.campaign.update({ where: { id: campaignId }, data: { status: 'paused' } });

    const rejected = await patchCampaign(campaignId, { goal: null });
    expect(rejected.statusCode).toBe(409);
    expect((await getCampaign(campaignId)).json().data.goalEditable).toBe(false);

    const renamed = await patchCampaign(campaignId, { name: '暂停后改名' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().data.status).toBe('paused');
  });

  it('开启同商品时，开始行为没有商品资料的旅程拒绝发布', async () => {
    const created = await createCampaignViaApi({
      name: '发布校验活动',
      goal: { eventType: 'purchase_completed', sameProduct: true },
    });
    const campaignId = created.json().data.id as string;
    const blocked = await seedJourneyForPublish({
      campaignId,
      name: '无商品开始',
      definition: waitDefinition('app_session_started'),
    });
    const allowed = await seedJourneyForPublish({
      campaignId,
      name: '有商品开始',
      definition: waitDefinition(),
    });

    const rejected = await app.inject({
      method: 'POST',
      url: `/api/journeys/${blocked.id}/publish`,
      headers: jsonHeaders(cookie),
      payload: JSON.stringify({ revision: 1, segmentRevision: null }),
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.message).toBe(
      '活动目标要按同一件商品算，但这个旅程的开始步骤没有商品，无法判断是否达成。请把开始步骤换成带商品的类型，或取消“只算同一件商品”。',
    );

    const published = await app.inject({
      method: 'POST',
      url: `/api/journeys/${allowed.id}/publish`,
      headers: jsonHeaders(cookie),
      payload: JSON.stringify({ revision: 1, segmentRevision: null }),
    });
    expect(published.statusCode).toBe(201);
  });
});

describe('目标达成与退出', () => {
  it('同商品目标命中后结束参与，等待步骤终止且后续消息不执行', async () => {
    const journey: TestJourney = await publishTestJourney(db, {
      name: '同商品目标',
      definition: waitDefinition(),
      campaignGoal: { eventType: 'purchase_completed', sameProduct: true },
    });

    const view = await ingestEvent({ type: 'product_viewed', payload: { productId: 'A' } });
    const executionId = view.executions[0]!.id;
    expect(await advance(executionId, 1)).toBe('waiting');

    const otherProduct = await ingestEvent({
      type: 'purchase_completed',
      payload: { productId: 'B', orderId: 'order-B' },
    });
    // 商品不一致不算达成，参与仍然等待。
    expect(await advance(executionId, 2)).toBe('waiting');

    const sameProduct = await ingestEvent({
      type: 'purchase_completed',
      payload: { productId: 'A', orderId: 'order-A' },
    });
    expect(otherProduct.event.id).not.toBe(sameProduct.event.id);
    expect(await advance(executionId, 3)).toBe('completed');

    const record = await execution(executionId);
    expect(record.status).toBe('completed');
    expect(record.goalReachedAt?.toISOString()).toBe(sameProduct.event.receivedAt);
    expect(record.goalEventId).toBe(sameProduct.event.id);
    expect(record.endedAt?.toISOString()).toBe(at(3).toISOString());
    // 等待步骤改为已停止，且不写入匹配行为；后续消息没有执行。
    const waitStep = record.steps.find((step) => step.nodeId === 'wait')!;
    expect(waitStep.status).toBe('stopped');
    expect(waitStep.matchedEventId).toBeNull();
    expect(record.steps.some((step) => step.nodeId === 'message')).toBe(false);
    expect(record.currentNodeId).toBe('wait');
    expect(journey.versionId).toBe(record.journeyVersionId);
  });

  it('关闭同商品时只按目标行为类型匹配', async () => {
    await publishTestJourney(db, {
      name: '类型目标',
      definition: waitDefinition(),
      campaignGoal: { eventType: 'purchase_completed', sameProduct: false },
    });

    const view = await ingestEvent({ type: 'product_viewed', payload: { productId: 'A' } });
    const executionId = view.executions[0]!.id;
    expect(await advance(executionId, 1)).toBe('waiting');

    const purchase = await ingestEvent({
      type: 'purchase_completed',
      payload: { productId: 'B', orderId: 'order-type-only' },
    });
    expect(await advance(executionId, 2)).toBe('completed');
    expect((await execution(executionId)).goalEventId).toBe(purchase.event.id);
  });

  it('进入行为和历史行为都不计入目标', async () => {
    await publishTestJourney(db, {
      name: '排除进入行为',
      definition: waitDefinition('purchase_completed'),
      campaignGoal: { eventType: 'purchase_completed', sameProduct: true },
    });

    // 进入行为本身就是一次购买：它不能把自己算成目标达成。
    const entry = await ingestEvent({
      type: 'purchase_completed',
      payload: { productId: 'A', orderId: 'order-entry' },
    });
    const executionId = entry.executions[0]!.id;
    // 进入前的历史购买同样不参与判定。
    await db.prisma.event.create({
      data: {
        id: randomUUID(),
        audienceUserId: (
          await db.prisma.audienceUser.findUniqueOrThrow({
            where: { externalId },
          })
        ).id,
        type: 'purchase_completed',
        payload: { productId: 'A' },
        audienceSnapshot: {},
        receivedAt: new Date(t0.getTime() - 60_000),
      },
    });

    expect(await advance(executionId, 1)).toBe('waiting');
    expect((await execution(executionId)).goalEventId).toBeNull();

    const later = await ingestEvent({
      type: 'purchase_completed',
      payload: { productId: 'A', orderId: 'order-later' },
    });
    expect(await advance(executionId, 2)).toBe('completed');
    expect((await execution(executionId)).goalEventId).toBe(later.event.id);
  });

  it('多次参与分别计数，概览达成次数按参与而非人数统计', async () => {
    const journey = await publishTestJourney(db, {
      name: '多次参与',
      definition: waitDefinition(),
      campaignGoal: { eventType: 'purchase_completed', sameProduct: true },
    });

    const first = await ingestEvent({ type: 'product_viewed', payload: { productId: 'A' } });
    const second = await ingestEvent({ type: 'product_viewed', payload: { productId: 'A' } });
    const firstId = first.executions[0]!.id;
    const secondId = second.executions[0]!.id;
    expect(firstId).not.toBe(secondId);
    expect(await advance(firstId, 1)).toBe('waiting');
    expect(await advance(secondId, 1)).toBe('waiting');

    const purchase = await ingestEvent({
      type: 'purchase_completed',
      payload: { productId: 'A', orderId: 'order-multi' },
    });
    expect(await advance(firstId, 2)).toBe('completed');
    expect(await advance(secondId, 3)).toBe('completed');

    const overview = await getOverview(journey.campaignId);
    expect(overview.json().data).toMatchObject({
      executionCount: 2,
      audienceCount: 1,
      goalReachedCount: 2,
      statusCounts: { running: 0, waiting: 0, completed: 2, failed: 0, stopped: 0 },
    });
    expect((await execution(firstId)).goalEventId).toBe(purchase.event.id);
    expect((await execution(secondId)).goalEventId).toBe(purchase.event.id);
  });

  it('目标优先于等待匹配，同一行为不进入等待成功分支', async () => {
    await publishTestJourney(db, {
      name: '目标优先',
      definition: waitForPurchaseDefinition(),
      campaignGoal: { eventType: 'purchase_completed', sameProduct: true },
    });

    const view = await ingestEvent({ type: 'product_viewed', payload: { productId: 'A' } });
    const executionId = view.executions[0]!.id;
    expect(await advance(executionId, 1)).toBe('waiting');

    const purchase = await ingestEvent({
      type: 'purchase_completed',
      payload: { productId: 'A', orderId: 'order-first' },
    });
    expect(await advance(executionId, 2)).toBe('completed');

    const record = await execution(executionId);
    expect(record.goalEventId).toBe(purchase.event.id);
    const waitStep = record.steps.find((step) => step.nodeId === 'wait-purchase')!;
    expect(waitStep.status).toBe('stopped');
    expect(waitStep.matchedEventId).toBeNull();
    expect(record.steps.some((step) => step.nodeId === 'message')).toBe(false);
  });

  it('已停止的参与不再补记目标', async () => {
    const journey = await publishTestJourney(db, {
      name: '停止后不补算',
      definition: waitDefinition(),
      campaignGoal: { eventType: 'purchase_completed', sameProduct: true },
    });

    const view = await ingestEvent({ type: 'product_viewed', payload: { productId: 'A' } });
    const executionId = view.executions[0]!.id;
    expect(await advance(executionId, 1)).toBe('waiting');

    // 停止先提交：参与成为已停止，之后保存的目标行为不再补算。
    await ingestEvent({
      type: 'purchase_completed',
      payload: { productId: 'A', orderId: 'order-1' },
    });
    const stop = await app.inject({
      method: 'POST',
      url: `/api/campaigns/${journey.campaignId}/stop`,
      headers: jsonHeaders(cookie),
      payload: JSON.stringify({}),
    });
    expect(stop.statusCode).toBe(200);

    expect(await advance(executionId, 2)).toBe('stopped');
    const record = await execution(executionId);
    expect(record.status).toBe('stopped');
    expect(record.goalEventId).toBeNull();
    expect(record.goalReachedAt).toBeNull();
    expect((await getOverview(journey.campaignId)).json().data.goalReachedCount).toBe(0);
  });

  it('指针为空时仍先确认目标，未命中才按缺失指针失败', async () => {
    const journey = await publishTestJourney(db, {
      name: '指针为空',
      definition: waitDefinition(),
      campaignGoal: { eventType: 'purchase_completed', sameProduct: true },
    });
    const audience = await db.prisma.audienceUser.findUniqueOrThrow({ where: { externalId } });
    const view = await ingestEvent({ type: 'product_viewed', payload: { productId: 'A' } });
    const purchase = await ingestEvent({
      type: 'purchase_completed',
      payload: { productId: 'A', orderId: 'order-null-pointer' },
    });
    const journeyRecord = await db.prisma.journey.findUniqueOrThrow({
      where: { id: journey.journeyId },
    });

    async function seedExecution(startedAt: Date, triggerEventId: string): Promise<string> {
      const created = await db.prisma.execution.create({
        data: {
          campaignId: journey.campaignId,
          journeyId: journeyRecord.id,
          journeyVersionId: journey.versionId,
          audienceUserId: audience.id,
          triggerEventId,
          status: 'running',
          currentNodeId: null,
          createdAt: startedAt,
          startedAt,
        },
        select: { id: true },
      });
      return created.id;
    }

    // 目标行为早于本次参与的开始时间：不参与判定，保留原有“指针缺失即失败”的处理。
    const lateStart = new Date(t0.getTime() + 100_000);
    // 用不进入该旅程的行为作为触发行为，避免与已有参与的唯一约束冲突。
    const plainTrigger = await ingestEvent({
      type: 'reservation_created',
      payload: { reservationId: 'reservation-1' },
    });
    const plain = await seedExecution(lateStart, plainTrigger.event.id);
    expect(await advance(plain, 101)).toBe('failed');
    const failed = await execution(plain);
    expect(failed.failureReason).toBe('当前步骤缺失，无法继续执行');
    expect(failed.goalEventId).toBeNull();

    // 目标已经命中：即使指针为空也记录达成并退出。
    // 直接写入一条浏览行为作为触发行为：不经过接收流程，因此不会自动创建参与。
    const viewEvent = await db.prisma.event.create({
      data: {
        id: randomUUID(),
        audienceUserId: audience.id,
        type: 'product_viewed',
        payload: { productId: 'A' },
        audienceSnapshot: {},
        receivedAt: t0,
      },
      select: { id: true },
    });
    const targeted = await seedExecution(t0, viewEvent.id);
    expect(await advance(targeted, 102)).toBe('completed');
    const completedRecord = await execution(targeted);
    expect(completedRecord.goalEventId).toBe(purchase.event.id);
    expect(completedRecord.currentNodeId).toBeNull();
    expect(view.executions).toHaveLength(1);
  });

  it('重复上报同一行为只返回原事实，新的目标行为不覆盖首次证据', async () => {
    const journey = await publishTestJourney(db, {
      name: '首次证据',
      definition: waitDefinition(),
      campaignGoal: { eventType: 'purchase_completed', sameProduct: true },
    });

    const view = await ingestEvent({ type: 'product_viewed', payload: { productId: 'A' } });
    const executionId = view.executions[0]!.id;
    expect(await advance(executionId, 1)).toBe('waiting');

    const firstPurchase = await ingestEvent({
      type: 'purchase_completed',
      payload: { productId: 'A', orderId: 'order-1' },
    });
    expect(await advance(executionId, 2)).toBe('completed');
    const before = await execution(executionId);

    // 同 ID 重试只返回原行为与原有参与，不新增达成事实。
    const retried = await ingestEvent({
      type: 'purchase_completed',
      payload: { productId: 'A', orderId: 'order-1' },
      id: firstPurchase.event.id,
      expectedStatus: 200,
    });
    expect(retried.duplicate).toBe(true);
    expect(await advance(executionId, 3)).toBe('completed');

    // 另一条购买行为也不会改写首次证据。
    await ingestEvent({
      type: 'purchase_completed',
      payload: { productId: 'A', orderId: 'order-2' },
    });
    expect(await advance(executionId, 4)).toBe('completed');

    const after = await execution(executionId);
    expect(after.goalEventId).toBe(before.goalEventId);
    expect(after.goalReachedAt?.toISOString()).toBe(before.goalReachedAt?.toISOString());
    expect(after.endedAt?.toISOString()).toBe(before.endedAt?.toISOString());
    expect((await getOverview(journey.campaignId)).json().data.goalReachedCount).toBe(1);
  });
});

describe('目标结果的读取', () => {
  it('执行详情返回目标配置、首次达成事实和结束原因', async () => {
    const journey = await publishTestJourney(db, {
      name: '证据读取',
      definition: waitDefinition(),
      campaignGoal: { eventType: 'purchase_completed', sameProduct: true },
    });
    const view = await ingestEvent({ type: 'product_viewed', payload: { productId: 'A' } });
    const executionId = view.executions[0]!.id;
    expect(await advance(executionId, 1)).toBe('waiting');
    const purchase = await ingestEvent({
      type: 'purchase_completed',
      payload: { productId: 'A', orderId: 'order-9' },
    });
    expect(await advance(executionId, 2)).toBe('completed');

    const trace = await app.inject({
      method: 'GET',
      url: `/api/executions/${executionId}/trace`,
      headers: { cookie },
    });
    expect(trace.statusCode).toBe(200);
    expect(trace.json().data.goal).toEqual({
      eventType: 'purchase_completed',
      sameProduct: true,
      reachedAt: purchase.event.receivedAt,
      event: {
        id: purchase.event.id,
        type: 'purchase_completed',
        receivedAt: purchase.event.receivedAt,
        payload: { productId: 'A', orderId: 'order-9' },
      },
    });

    const list = await app.inject({
      method: 'GET',
      url: `/api/executions?campaignId=${journey.campaignId}`,
      headers: { cookie },
    });
    expect(list.json().data[0]).toMatchObject({
      status: 'completed',
      result: '目标已达成，已退出旅程',
    });
  });

  it('未设置目标的活动不产生达成事实，概览不显示达成次数', async () => {
    const created = await createCampaignViaApi({ name: '无目标运行' });
    const campaignId = created.json().data.id as string;
    await db.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'running' },
    });
    const seeded = await seedJourneyForPublish({
      campaignId,
      name: '无目标旅程',
      definition: waitDefinition(),
    });
    await db.prisma.journeyVersion.create({
      data: {
        journeyId: seeded.id,
        versionNumber: 1,
        sourceRevision: 1,
        snapshot: {
          name: '无目标旅程',
          description: null,
          entrySegment: null,
          definition: waitDefinition(),
        },
        publishedById: testAccountId,
        publishedAt: t0,
      },
    });

    const view = await ingestEvent({ type: 'product_viewed', payload: { productId: 'A' } });
    const executionId = view.executions[0]!.id;
    expect(await advance(executionId, 1)).toBe('waiting');
    await ingestEvent({
      type: 'purchase_completed',
      payload: { productId: 'A', orderId: 'order-no-goal' },
    });
    // 无目标时按原规则继续等待，不产生达成事实。
    expect(await advance(executionId, 2)).toBe('waiting');
    expect((await execution(executionId)).goalEventId).toBeNull();

    const overview = await getOverview(campaignId);
    expect(overview.json().data.goalReachedCount).toBeNull();
    const campaignDetail = await getCampaign(campaignId);
    expect(campaignDetail.json().data.goal).toBeNull();
  });
});
