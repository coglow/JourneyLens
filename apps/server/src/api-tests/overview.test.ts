import { randomUUID } from 'node:crypto';
import type { ExecutionStatus } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { overviewResponseSchema } from '@journeylens/shared';
import {
  createAudienceUser,
  minimalDefinition,
  publishTestJourney,
  type TestJourney,
} from '../test-support/execution-fixtures.js';
import { makeApp, signedInCookie, type TestApp } from '../test-support/harness.js';
import {
  startTestDatabase,
  testAccountId,
  testNow,
  type TestDatabase,
} from '../test-support/test-database.js';

let db: TestDatabase;
let userId: string;
const week = 168 * 60 * 60 * 1000;
const at = (offset: number) => new Date(testNow.getTime() + offset);

beforeAll(async () => {
  db = await startTestDatabase();
});
beforeEach(async () => {
  await db.reset();
  userId = await createAudienceUser(db, { externalId: 'overview-user', displayName: '概览用户' });
});
afterAll(async () => {
  await db?.close();
});

function journey(
  name: string,
  goal = false,
  campaignStatus: 'running' | 'paused' | 'stopped' | 'draft' = 'running',
) {
  return publishTestJourney(db, {
    name,
    definition: minimalDefinition(),
    publishedAt: at(-10 * 24 * 60 * 60 * 1000),
    campaignStatus,
    ...(goal ? { campaignGoal: { eventType: 'purchase_completed' as const } } : {}),
  });
}

async function execution(
  resource: TestJourney,
  input: {
    createdAt: Date;
    status?: ExecutionStatus;
    endedAt?: Date;
    goalAt?: Date;
    versionId?: string;
  },
) {
  const event = await db.prisma.event.create({
    data: {
      id: randomUUID(),
      audienceUserId: userId,
      type: 'product_viewed',
      payload: { productId: 'overview-product', price: 100 },
      audienceSnapshot: { displayName: '概览用户', email: null, attributes: {} },
      receivedAt: input.createdAt,
    },
  });
  const goalEvent =
    input.goalAt === undefined
      ? null
      : await db.prisma.event.create({
          data: {
            id: randomUUID(),
            audienceUserId: userId,
            type: 'purchase_completed',
            payload: { productId: 'overview-product', amount: 100 },
            audienceSnapshot: { displayName: '概览用户', email: null, attributes: {} },
            receivedAt: input.goalAt,
          },
        });
  return db.prisma.execution.create({
    data: {
      campaignId: resource.campaignId,
      journeyId: resource.journeyId,
      journeyVersionId: input.versionId ?? resource.versionId,
      audienceUserId: userId,
      triggerEventId: event.id,
      status: input.status ?? 'waiting',
      currentNodeId: input.status === 'completed' ? 'end' : 'start',
      createdAt: input.createdAt,
      startedAt: input.createdAt,
      endedAt: input.endedAt ?? null,
      goalReachedAt: input.goalAt ?? null,
      goalEventId: goalEvent?.id ?? null,
      failureReason: input.status === 'failed' ? '验收记录中的步骤执行失败' : null,
    },
  });
}

async function snapshot(app: TestApp, cookie: string) {
  const response = await app.inject({ method: 'GET', url: '/api/overview', headers: { cookie } });
  expect(response.statusCode).toBe(200);
  return overviewResponseSchema.parse(response.json()).data;
}

describe('首页运营概览', () => {
  it('要求登录，空执行不伪造数据，当前活动数独立于进入记录，查询只读', async () => {
    const { app } = makeApp(db);
    try {
      expect((await app.inject({ method: 'GET', url: '/api/overview' })).statusCode).toBe(401);
      const cookie = await signedInCookie(app);
      expect(await snapshot(app, cookie)).toEqual({
        windowStartedAt: at(-week).toISOString(),
        windowEndedAt: testNow.toISOString(),
        campaignStatusCounts: { draft: 0, running: 0, paused: 0, stopped: 0 },
        entryCount: 0,
        goalReachedCount: 0,
        failedCount: 0,
        recentJourneys: [],
        recentCampaigns: [],
      });
      for (const status of ['draft', 'running', 'paused', 'stopped'] as const) {
        await journey(status, false, status);
      }
      const old = await journey('较早创建的草稿', false, 'draft');
      await db.prisma.campaign.update({
        where: { id: old.campaignId },
        data: { createdAt: at(-2 * week) },
      });
      const before = await db.prisma.campaign.findMany({ orderBy: { id: 'asc' } });
      expect(await snapshot(app, cookie)).toMatchObject({
        campaignStatusCounts: { draft: 2, running: 1, paused: 1, stopped: 1 },
        entryCount: 0,
        recentCampaigns: [],
      });
      expect(await db.prisma.campaign.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
      expect(await db.prisma.execution.count()).toBe(0);
      expect(await db.prisma.executionStep.count()).toBe(0);
      await db.prisma.campaign.update({
        where: { id: old.campaignId },
        data: { status: 'running' },
      });
      expect((await snapshot(app, cookie)).campaignStatusCounts).toEqual({
        draft: 1,
        running: 2,
        paused: 1,
        stopped: 1,
      });
    } finally {
      await app.close();
    }
  });

  it('按进入、目标行为和确认结束各自的时间汇总，跨状态、用户重复参与及版本不丢失或重复计数', async () => {
    const first = await journey('购买引导', true);
    const paused = await journey('已暂停活动', false, 'paused');
    const stopped = await journey('已停止活动', false, 'stopped');
    await journey('未进入的进行中活动');
    const original = await db.prisma.journeyVersion.findUniqueOrThrow({
      where: { id: first.versionId },
    });
    const version = await db.prisma.journeyVersion.create({
      data: {
        journeyId: first.journeyId,
        versionNumber: 2,
        sourceRevision: 1,
        snapshot: original.snapshot!,
        publishedById: testAccountId,
        publishedAt: at(-week - 5000),
      },
    });
    await execution(first, {
      createdAt: at(-week + 1000),
      status: 'completed',
      endedAt: at(-10000),
    });
    await execution(first, {
      createdAt: at(-week - 2000),
      status: 'completed',
      goalAt: at(-9000),
      endedAt: at(-8000),
    });
    await execution(first, {
      createdAt: at(-week + 2000),
      status: 'failed',
      endedAt: at(-7000),
      versionId: version.id,
    });
    await execution(first, { createdAt: at(-week + 3000) });
    await execution(first, {
      createdAt: at(-week - 2000),
      status: 'completed',
      goalAt: at(-week - 1),
      endedAt: at(-6000),
    });
    await execution(paused, {
      createdAt: at(-week + 4000),
      status: 'completed',
      endedAt: at(-5000),
    });
    await execution(stopped, {
      createdAt: at(-week + 5000),
      status: 'stopped',
      endedAt: at(-4000),
    });
    await execution(first, { createdAt: at(1), status: 'completed', endedAt: at(2) });

    const before = await db.prisma.execution.findMany({ orderBy: { id: 'asc' } });
    const { app } = makeApp(db);
    try {
      const result = await snapshot(app, await signedInCookie(app));
      expect(result).toMatchObject({
        campaignStatusCounts: { draft: 0, running: 2, paused: 1, stopped: 1 },
        entryCount: 5,
        goalReachedCount: 1,
        failedCount: 1,
      });
      expect(result.recentCampaigns).toEqual([
        {
          id: stopped.campaignId,
          name: '测试活动 已停止活动',
          status: 'stopped',
          entryCount: 1,
          goalReachedCount: null,
          failedCount: 0,
        },
        {
          id: paused.campaignId,
          name: '测试活动 已暂停活动',
          status: 'paused',
          entryCount: 1,
          goalReachedCount: null,
          failedCount: 0,
        },
        {
          id: first.campaignId,
          name: '测试活动 购买引导',
          status: 'running',
          entryCount: 3,
          goalReachedCount: 1,
          failedCount: 1,
        },
      ]);
      expect(await db.prisma.execution.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    } finally {
      await app.close();
    }
  });

  it('各时间范围包含起止两端，排除范围外记录，有目标但零达成保留真实的 0', async () => {
    const resource = await journey('时间边界', true);
    const zeroGoal = await journey('尚未达成', true);
    for (const offset of [-week - 1, -week, 0, 1]) {
      await execution(resource, { createdAt: at(offset) });
      await execution(resource, {
        createdAt: at(-week - 2000),
        status: 'completed',
        goalAt: at(offset),
        endedAt: at(offset),
      });
      await execution(resource, {
        createdAt: at(-week - 2000),
        status: 'failed',
        endedAt: at(offset),
      });
    }
    await execution(zeroGoal, { createdAt: at(-100) });
    const { app } = makeApp(db);
    try {
      const result = await snapshot(app, await signedInCookie(app));
      expect(result).toMatchObject({
        entryCount: 3,
        goalReachedCount: 2,
        failedCount: 2,
      });
      expect(result.recentCampaigns.find((row) => row.id === resource.campaignId)).toMatchObject({
        entryCount: 2,
        goalReachedCount: 2,
        failedCount: 2,
      });
      expect(
        result.recentCampaigns.find((row) => row.id === zeroGoal.campaignId)?.goalReachedCount,
      ).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('同一最近进入时间按活动 ID 稳定选前十条，不以资料更新时间或仅有近期结束的记录选入', async () => {
    const resources: TestJourney[] = [];
    for (let index = 0; index < 11; index++) {
      const resource = await journey(`候选 ${index}`);
      resources.push(resource);
      await execution(resource, { createdAt: at(-1000) });
    }
    const old = await journey('只有近期失败');
    await execution(old, { createdAt: at(-week - 1000), status: 'failed', endedAt: at(-10) });
    const expected = resources
      .map((row) => row.campaignId)
      .sort()
      .reverse()
      .slice(0, 10);
    await db.prisma.campaign.update({
      where: { id: resources.find((row) => !expected.includes(row.campaignId))!.campaignId },
      data: { updatedAt: at(1000) },
    });
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const result = await snapshot(app, cookie);
      expect(result.entryCount).toBe(11);
      expect(result.failedCount).toBe(1);
      expect(result.recentCampaigns.map((row) => row.id)).toEqual(expected);
      expect((await snapshot(app, cookie)).recentCampaigns).toEqual(result.recentCampaigns);
    } finally {
      await app.close();
    }
  });

  it('近期旅程按最新发布时间倒序，不限活动状态与发布时间，未发布的旅程不计入', async () => {
    const older = await publishTestJourney(db, {
      name: '较早发布',
      definition: minimalDefinition(),
      publishedAt: at(-3 * 24 * 60 * 60 * 1000),
      campaignStatus: 'running',
    });
    const newest = await publishTestJourney(db, {
      name: '最近发布',
      definition: minimalDefinition(),
      publishedAt: at(-24 * 60 * 60 * 1000),
      campaignStatus: 'paused',
    });
    const longAgo = await publishTestJourney(db, {
      name: '很久以前发布',
      definition: minimalDefinition(),
      publishedAt: at(-90 * 24 * 60 * 60 * 1000),
      campaignStatus: 'stopped',
    });
    // 从未发布过的旅程没有版本，不进入列表。
    await db.prisma.journey.create({
      data: {
        name: '未发布旅程',
        campaignId: older.campaignId,
        createdById: testAccountId,
        updatedById: testAccountId,
      },
    });

    const { app } = makeApp(db);
    try {
      const result = await snapshot(app, await signedInCookie(app));
      expect(result.recentJourneys.map((row) => row.id)).toEqual([
        newest.journeyId,
        older.journeyId,
        longAgo.journeyId,
      ]);
      expect(result.recentJourneys[0]).toEqual({
        id: newest.journeyId,
        name: '最近发布',
        campaign: { id: newest.campaignId, name: '测试活动 最近发布', status: 'paused' },
        versionId: newest.versionId,
        versionNumber: 1,
        publishedAt: at(-24 * 60 * 60 * 1000).toISOString(),
      });
    } finally {
      await app.close();
    }
  });

  it('同一次响应在一个可重复读事务中读取，各组成部分不会跨快照混读', async () => {
    const { app } = makeApp(db);
    const transaction = vi.spyOn(db.prisma, '$transaction');
    try {
      await snapshot(app, await signedInCookie(app));
      // 顶部状态统计与近期活动列表分多条语句读取；去掉隔离级别后每条语句会各自取新快照，
      // 并发暂停活动时可能出现“进行中 1、已暂停 0”与“近期活动显示已暂停”同时存在。
      expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'RepeatableRead',
      });
    } finally {
      transaction.mockRestore();
      await app.close();
    }
  });
});
