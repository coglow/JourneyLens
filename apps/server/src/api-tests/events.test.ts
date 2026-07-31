import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SegmentRule } from '@journeylens/shared';
import { jsonHeaders, makeApp, signedInCookie, type TestApp } from '../test-support/harness.js';
import { startTestDatabase, type TestDatabase } from '../test-support/test-database.js';
import {
  addTestVersion,
  createAudienceUser,
  minimalDefinition,
  publishTestJourney,
  type TestJourney,
} from '../test-support/execution-fixtures.js';

let db: TestDatabase;
let app: TestApp;
let cookie: string;

const eligibleExternalId = 'upstream:demo:eligible';
const eventId = '3f1c9f1e-2b7a-4d5c-8e9f-0a1b2c3d4e5f';

function browseBody(overrides: Record<string, unknown> = {}) {
  return {
    id: eventId,
    audienceExternalId: eligibleExternalId,
    type: 'product_viewed',
    payload: { productId: 'product-1', price: 299 },
    ...overrides,
  };
}

async function ingest(body: unknown, headers: Record<string, string> = jsonHeaders(cookie)) {
  return app.inject({
    method: 'POST',
    url: '/api/events/ingest',
    headers,
    payload: body as Record<string, unknown>,
  });
}

async function pauseCampaign(journey: TestJourney) {
  return app.inject({
    method: 'POST',
    url: `/api/campaigns/${journey.campaignId}/pause`,
    headers: jsonHeaders(cookie),
    payload: {},
  });
}

async function resumeCampaign(journey: TestJourney) {
  return app.inject({
    method: 'POST',
    url: `/api/campaigns/${journey.campaignId}/resume`,
    headers: jsonHeaders(cookie),
    payload: {},
  });
}

beforeAll(async () => {
  db = await startTestDatabase();
  ({ app } = makeApp(db));
  cookie = await signedInCookie(app);
});

afterEach(async () => {
  await db.reset();
  // reset 会清空会话表，下一个用例重新登录取得有效会话。
  cookie = await signedInCookie(app);
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('上游行为接收与创建执行', () => {
  it('符合入口时保存行为并创建固定版本的运行中执行', async () => {
    await createAudienceUser(db, {
      externalId: eligibleExternalId,
      displayName: '霖铃铃',
      email: 'lin@example.com',
      attributes: { vipLevel: 'gold' },
    });
    const journey = await publishTestJourney(db, {
      name: '浏览旅程',
      definition: minimalDefinition(),
    });

    const response = await ingest(browseBody());
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.data.duplicate).toBe(false);
    expect(body.data.event.id).toBe(eventId);
    expect(body.data.executions).toHaveLength(1);

    const execution = await db.prisma.execution.findUniqueOrThrow({
      where: { id: body.data.executions[0].id },
      include: { audienceUser: true, triggerEvent: true },
    });
    expect(execution.journeyId).toBe(journey.journeyId);
    expect(execution.journeyVersionId).toBe(journey.versionId);
    expect(execution.campaignId).toBe(journey.campaignId);
    expect(execution.status).toBe('running');
    expect(execution.currentNodeId).toBe('start');
    expect(execution.audienceUser.externalId).toBe(eligibleExternalId);
    expect(execution.triggerEvent.audienceSnapshot).toMatchObject({
      displayName: '霖铃铃',
      email: 'lin@example.com',
      attributes: { vipLevel: 'gold' },
    });
  });

  it('不符合入口人群时保存行为但不创建假执行', async () => {
    await createAudienceUser(db, {
      externalId: 'upstream:demo:ineligible',
      displayName: '周小北',
      attributes: { vipLevel: 'normal' },
    });
    const segmentRules: SegmentRule = {
      kind: 'compare',
      left: { source: 'user', path: 'vipLevel' },
      operator: 'in',
      right: ['gold', 'platinum'],
    };
    await publishTestJourney(db, {
      name: '高价值旅程',
      definition: minimalDefinition(),
      entrySegment: { name: '高价值人群', rules: segmentRules },
    });

    const response = await ingest(
      browseBody({ audienceExternalId: 'upstream:demo:ineligible', id: randomUUID() }),
    );
    expect(response.statusCode).toBe(201);
    expect(response.json().data.executions).toEqual([]);
    expect(await db.prisma.event.count()).toBe(1);
    expect(await db.prisma.execution.count()).toBe(0);
  });

  it('同一 ID 同内容重试返回原执行，不同内容明确拒绝', async () => {
    await createAudienceUser(db, { externalId: eligibleExternalId, displayName: '霖铃铃' });
    await publishTestJourney(db, { name: '重试旅程', definition: minimalDefinition() });

    const first = await ingest(browseBody());
    const repeated = await ingest(browseBody());
    expect(first.statusCode).toBe(201);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data.duplicate).toBe(true);
    expect(repeated.json().data.executions).toEqual(first.json().data.executions);
    expect(await db.prisma.event.count()).toBe(1);
    expect(await db.prisma.execution.count()).toBe(1);

    const conflict = await ingest(browseBody({ payload: { productId: 'product-1', price: 100 } }));
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('EVENT_ID_CONFLICT');
    expect(await db.prisma.event.count()).toBe(1);
  });

  it('同一 ID 并发提交只保存一条行为和一组执行', async () => {
    await createAudienceUser(db, { externalId: eligibleExternalId, displayName: '霖铃铃' });
    await publishTestJourney(db, { name: '并发旅程', definition: minimalDefinition() });

    const responses = await Promise.all([ingest(browseBody()), ingest(browseBody())]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    expect(await db.prisma.event.count()).toBe(1);
    expect(await db.prisma.execution.count()).toBe(1);
    expect(responses[0]!.json().data.executions).toEqual(responses[1]!.json().data.executions);
  });

  it('同一 ID 不同标识不能复用已有行为', async () => {
    await createAudienceUser(db, { externalId: eligibleExternalId, displayName: '霖铃铃' });
    await createAudienceUser(db, {
      externalId: 'upstream:demo:other',
      displayName: '另一位用户',
    });
    await publishTestJourney(db, { name: '用户标识旅程', definition: minimalDefinition() });

    expect((await ingest(browseBody())).statusCode).toBe(201);
    const conflict = await ingest(browseBody({ audienceExternalId: 'upstream:demo:other' }));
    expect(conflict.statusCode).toBe(409);
    expect(await db.prisma.execution.count()).toBe(1);
  });

  it('未知用户、非法输入、未登录和错误来源都不会创建执行', async () => {
    await publishTestJourney(db, { name: '校验旅程', definition: minimalDefinition() });

    const unknown = await ingest(browseBody());
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('AUDIENCE_NOT_FOUND');

    await createAudienceUser(db, { externalId: eligibleExternalId, displayName: '霖铃铃' });
    const invalid = await ingest(browseBody({ payload: {} }));
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.message).toContain('商品 ID 不能为空');

    const unauthenticated = await ingest(browseBody(), {
      host: 'localhost',
      origin: 'http://localhost',
      'content-type': 'application/json',
    });
    expect(unauthenticated.statusCode).toBe(401);

    const badOrigin = await ingest(browseBody(), {
      ...jsonHeaders(cookie),
      origin: 'http://evil.example',
    });
    expect(badOrigin.statusCode).toBe(403);

    expect(await db.prisma.event.count()).toBe(0);
    expect(await db.prisma.execution.count()).toBe(0);
  });

  it('新行为只使用最新发布版本，不回退到旧版本', async () => {
    await createAudienceUser(db, { externalId: eligibleExternalId, displayName: '霖铃铃' });
    const journey = await publishTestJourney(db, {
      name: '版本切换旅程',
      definition: minimalDefinition('product_viewed'),
    });
    await addTestVersion(db, journey.journeyId, {
      versionNumber: 2,
      name: '版本切换旅程',
      definition: minimalDefinition('purchase_completed'),
    });

    const response = await ingest(browseBody());
    expect(response.statusCode).toBe(201);
    expect(response.json().data.executions).toEqual([]);
  });

  it('入口人群来自发布时的分群快照，不读取当前分群规则', async () => {
    await createAudienceUser(db, {
      externalId: eligibleExternalId,
      displayName: '霖铃铃',
      attributes: { vipLevel: 'gold' },
    });
    const rules: SegmentRule = {
      kind: 'compare',
      left: { source: 'user', path: 'vipLevel' },
      operator: 'in',
      right: ['gold', 'platinum'],
    };
    const journey = await publishTestJourney(db, {
      name: '快照旅程',
      definition: minimalDefinition(),
      entrySegment: { name: '快照人群', rules },
    });
    await db.prisma.segment.update({
      where: { id: journey.segmentId! },
      data: {
        rules: {
          kind: 'compare',
          left: { source: 'user', path: 'vipLevel' },
          operator: 'eq',
          right: 'normal',
        },
      },
    });

    const response = await ingest(browseBody());
    expect(response.json().data.executions).toHaveLength(1);
  });

  it('进行中的每个旅程都可进入，同一行为只创建各自一条执行', async () => {
    await createAudienceUser(db, { externalId: eligibleExternalId, displayName: '霖铃铃' });
    await publishTestJourney(db, { name: '旅程一', definition: minimalDefinition() });
    await publishTestJourney(db, { name: '旅程二', definition: minimalDefinition() });

    const response = await ingest(browseBody());
    expect(response.json().data.executions).toHaveLength(2);
    expect(await db.prisma.execution.count()).toBe(2);
  });

  it('暂停期间保存行为但不进入，恢复后只对之后的新行为开放', async () => {
    await createAudienceUser(db, { externalId: eligibleExternalId, displayName: '霖铃铃' });
    const journey = await publishTestJourney(db, {
      name: '暂停旅程',
      definition: minimalDefinition(),
    });

    expect((await pauseCampaign(journey)).statusCode).toBe(200);
    const pausedEventId = randomUUID();
    const pausedResponse = await ingest(browseBody({ id: pausedEventId }));
    expect(pausedResponse.statusCode).toBe(201);
    expect(pausedResponse.json().data.executions).toEqual([]);
    expect(await db.prisma.event.count()).toBe(1);
    expect(await db.prisma.execution.count()).toBe(0);

    expect((await resumeCampaign(journey)).statusCode).toBe(200);
    // 暂停期间保存的行为不补判。
    expect(await db.prisma.execution.count()).toBe(0);

    const resumedResponse = await ingest(browseBody({ id: randomUUID() }));
    expect(resumedResponse.json().data.executions).toHaveLength(1);
  });
});
