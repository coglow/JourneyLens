import type { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startTestDatabase,
  testAccountId,
  testNow,
  type TestDatabase,
} from '../test-support/test-database.js';
import { jsonHeaders, makeApp, signedInCookie, type TestApp } from '../test-support/harness.js';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

beforeEach(async () => {
  await db.reset();
});

afterAll(async () => {
  await db?.close();
});

afterEach(() => vi.restoreAllMocks());

const campaignId = '00000000-0000-4000-8400-000000000001';
const segmentId = '00000000-0000-4000-8401-000000000001';
const journeyId = '00000000-0000-4000-8402-000000000001';
const missingJourneyId = '00000000-0000-4000-8402-000000000099';
const audienceId = '00000000-0000-4000-8403-000000000001';

const adultRule = {
  kind: 'compare',
  left: { source: 'user', path: 'age' },
  operator: 'gte',
  right: 18,
};

const completeDraft = {
  layoutDirection: 'vertical',
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: '开始',
      position: { x: 0, y: 0 },
      entryBehavior: 'app_session_started',
    },
    {
      id: 'condition',
      type: 'condition',
      name: '成年用户',
      position: { x: 0, y: 100 },
      rules: adultRule,
    },
    { id: 'adult', type: 'end', name: '成年', position: { x: -120, y: 200 }, note: null },
    { id: 'minor', type: 'end', name: '未成年', position: { x: 120, y: 200 }, note: null },
  ],
  edges: [
    { id: 'to-condition', source: 'start', target: 'condition' },
    { id: 'age-met', source: 'condition', target: 'adult', branch: 'met' },
    { id: 'age-unmet', source: 'condition', target: 'minor', branch: 'unmet' },
  ],
};

const scenario = {
  user: { displayName: '临时用户', email: null, attributes: { age: 25 } },
  entryEvent: {
    id: 'entry-1',
    type: 'app_session_started',
    offsetSeconds: 0,
    payload: { sessionId: 'session-1' },
  },
  historicalEvents: [],
  scheduledEvents: [],
};

async function seedCampaign(): Promise<void> {
  await db.prisma.campaign.create({
    data: {
      id: campaignId,
      name: '模拟验收活动',
      status: 'draft',
      createdById: testAccountId,
      createdAt: testNow,
      updatedAt: testNow,
    },
  });
}

async function seedSegment(rules: unknown = adultRule): Promise<void> {
  await db.prisma.segment.create({
    data: {
      id: segmentId,
      name: '成年用户',
      rules: rules as Prisma.InputJsonValue,
      createdById: testAccountId,
      updatedById: testAccountId,
    },
  });
}

async function seedJourney(draftDefinition: unknown = completeDraft): Promise<void> {
  await db.prisma.journey.create({
    data: {
      id: journeyId,
      campaignId,
      segmentId,
      name: '模拟旅程',
      draftDefinition: draftDefinition as Prisma.InputJsonValue,
      createdById: testAccountId,
      updatedById: testAccountId,
    },
  });
}

function simulate(app: TestApp, cookie: string, payload: unknown, targetJourneyId = journeyId) {
  return app.inject({
    method: 'POST',
    url: `/api/journeys/${targetJourneyId}/simulate`,
    headers: jsonHeaders(cookie),
    payload: JSON.stringify(payload),
  });
}

describe('旅程模拟接口', () => {
  it('登录后旧的模拟受众读取入口也不再可用', async () => {
    const { app } = makeApp(db);
    const cookie = await signedInCookie(app);
    for (const path of ['simulation-users', `simulation-users/${audienceId}`]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/journeys/${journeyId}/${path}`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it('未登录时模拟接口要求登录', async () => {
    const { app } = makeApp(db);
    expect((await simulate(app, '', {})).statusCode).toBe(401);
  });

  it('自定义用户资料直接参与分群和节点判断，模拟过程不写入数据库', async () => {
    await seedCampaign();
    await seedSegment();
    await seedJourney();
    const before = await db.prisma.journey.findUniqueOrThrow({
      where: { id: journeyId },
      select: { revision: true, draftDefinition: true, updatedAt: true },
    });
    const segmentBefore = await db.prisma.segment.findUniqueOrThrow({
      where: { id: segmentId },
      select: { revision: true, updatedAt: true, rules: true },
    });
    const { app } = makeApp(db);
    const cookie = await signedInCookie(app);

    const response = await simulate(app, cookie, { draftDefinition: completeDraft, scenario });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      outcome: 'completed',
      user: { displayName: '临时用户' },
      admission: {
        segment: { id: segmentId, name: '成年用户', rules: adultRule, matched: true },
      },
      steps: [
        { nodeType: 'start' },
        {
          nodeType: 'condition',
          matched: true,
          evidence: { kind: 'value', actual: { exists: true, value: 25 } },
        },
        { nodeType: 'end', nodeId: 'adult' },
      ],
      traversedEdgeIds: ['to-condition', 'age-met'],
    });

    const byTemporaryProfile = await simulate(app, cookie, {
      draftDefinition: completeDraft,
      scenario: { ...scenario, user: { ...scenario.user, attributes: { age: 16 } } },
    });
    expect(byTemporaryProfile.json().data).toMatchObject({
      outcome: 'not_entered',
      admission: { segment: { matched: false } },
      steps: [],
    });

    expect(
      await db.prisma.journey.findUniqueOrThrow({
        where: { id: journeyId },
        select: { revision: true, draftDefinition: true, updatedAt: true },
      }),
    ).toEqual(before);
    expect(
      await db.prisma.segment.findUniqueOrThrow({
        where: { id: segmentId },
        select: { revision: true, updatedAt: true, rules: true },
      }),
    ).toEqual(segmentBefore);
    expect(await db.prisma.audienceUser.count()).toBe(0);
  });

  it('拒绝未完成流程、无效资料、旧请求格式及缺少来源的写请求', async () => {
    await seedCampaign();
    await seedSegment();
    await seedJourney();
    const { app } = makeApp(db);
    const cookie = await signedInCookie(app);

    const incomplete = await simulate(app, cookie, {
      draftDefinition: {
        ...completeDraft,
        edges: completeDraft.edges.filter((edge) => edge.id !== 'age-unmet'),
      },
      scenario,
    });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().error.code).toBe('JOURNEY_DRAFT_INCOMPLETE');

    const invalid = await simulate(app, cookie, {
      draftDefinition: completeDraft,
      scenario: { ...scenario, user: { ...scenario.user, attributes: { age: '25' } } },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.message).toBe('请检查模拟资料、行为内容和步骤设置');

    const oldRequest = await simulate(app, cookie, {
      draftDefinition: completeDraft,
      scenario,
      audienceUserId: audienceId,
    });
    expect(oldRequest.statusCode).toBe(400);

    const noOrigin = await app.inject({
      method: 'POST',
      url: `/api/journeys/${journeyId}/simulate`,
      headers: { host: 'localhost', cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ draftDefinition: completeDraft, scenario }),
    });
    expect(noOrigin.statusCode).toBe(403);
    expect(noOrigin.json().error.code).toBe('INVALID_ORIGIN');
    expect(
      (await simulate(app, cookie, { draftDefinition: completeDraft, scenario }, missingJourneyId))
        .statusCode,
    ).toBe(404);
  });
});
