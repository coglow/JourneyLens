import type { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { journeyStatsListResponseSchema, journeyVersionSnapshotSchema } from '@journeylens/shared';
import {
  startTestDatabase,
  testAccountId,
  type TestDatabase,
} from '../test-support/test-database.js';
import { makeApp, signedInCookie, type TestApp } from '../test-support/harness.js';
import { minimalDefinition } from '../test-support/execution-fixtures.js';

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

async function createCampaign(name: string): Promise<string> {
  const campaign = await db.prisma.campaign.create({
    data: { name, createdById: testAccountId },
    select: { id: true },
  });
  return campaign.id;
}

/** 直接写入旅程与指定数量的发布版本；versions 为 0 表示只有草稿、从未发布。 */
async function createJourney(
  campaignId: string,
  name: string,
  options: { versions?: number; description?: string; updatedAt?: Date } = {},
): Promise<{ journeyId: string; versionIds: string[] }> {
  const journey = await db.prisma.journey.create({
    data: {
      campaignId,
      name,
      description: options.description ?? null,
      createdById: testAccountId,
      updatedById: testAccountId,
      ...(options.updatedAt === undefined ? {} : { updatedAt: options.updatedAt }),
    },
    select: { id: true },
  });

  const versionIds: string[] = [];
  for (let versionNumber = 1; versionNumber <= (options.versions ?? 1); versionNumber += 1) {
    const snapshot = journeyVersionSnapshotSchema.parse({
      name,
      description: options.description ?? null,
      entrySegment: null,
      definition: minimalDefinition(),
    });
    const version = await db.prisma.journeyVersion.create({
      data: {
        journeyId: journey.id,
        versionNumber,
        sourceRevision: versionNumber,
        sourceSegmentRevision: null,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        publishedById: testAccountId,
        publishedAt: new Date('2026-07-16T08:00:00.000Z'),
      },
      select: { id: true },
    });
    versionIds.push(version.id);
  }

  return { journeyId: journey.id, versionIds };
}

function listStats(app: TestApp, cookie: string, query = '') {
  return app.inject({
    method: 'GET',
    url: `/api/journey-stats${query}`,
    headers: { cookie },
  });
}

describe('旅程统计列表 API', () => {
  it('要求登录，并对分页、活动标识和搜索词给出明确错误', async () => {
    const { app } = makeApp(db);
    try {
      const anonymous = await app.inject({ method: 'GET', url: '/api/journey-stats' });
      expect(anonymous.statusCode).toBe(401);

      const cookie = await signedInCookie(app);
      const cases = [
        { query: '?pageSize=5', message: '每页条数只能选择 10、20 或 50 条' },
        { query: '?page=0', message: '页码必须是正整数' },
        { query: `?q=${'x'.repeat(101)}`, message: '搜索词最多 100 个字符' },
        { query: '?campaignId=not-a-uuid', message: '请选择有效的活动' },
      ];
      for (const item of cases) {
        const response = await listStats(app, cookie, item.query);
        expect(response.statusCode).toBe(400);
        expect(response.json().error.message).toContain(item.message);
      }
    } finally {
      await app.close();
    }
  });

  it('只列出已有发布版本的旅程，并返回所属活动与版本号最大的版本', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const firstCampaign = await createCampaign('浏览挽回活动');
      const secondCampaign = await createCampaign('复购活动');
      const published = await createJourney(firstCampaign, '浏览后购买挽回', { versions: 3 });
      await createJourney(firstCampaign, '从未发布的旅程', { versions: 0 });
      const sameNameElsewhere = await createJourney(secondCampaign, '浏览后购买挽回', {
        versions: 1,
      });

      // 没有执行记录也照常列出，执行数量不参与筛选。
      expect(await db.prisma.execution.count()).toBe(0);

      const response = await listStats(app, cookie);
      expect(response.statusCode).toBe(200);
      // 用共享契约解析响应，字段多缺都会失败。
      const body = journeyStatsListResponseSchema.parse(response.json());
      expect(body.page).toEqual({ page: 1, pageSize: 10, total: 2 });
      expect(body.data.map((item) => item.name)).toEqual(['浏览后购买挽回', '浏览后购买挽回']);

      const byCampaign = new Map(body.data.map((item) => [item.campaign.id, item] as const));
      const first = byCampaign.get(firstCampaign)!;
      expect(first.campaign).toEqual({
        id: firstCampaign,
        name: '浏览挽回活动',
        status: 'draft',
      });
      // 最新版本按版本号取，不是按写入顺序，也不是版本数量。
      expect(first.latestVersion).toEqual({
        id: published.versionIds[2],
        versionNumber: 3,
        publishedAt: '2026-07-16T08:00:00.000Z',
      });
      expect(byCampaign.get(secondCampaign)!.latestVersion.id).toBe(
        sameNameElsewhere.versionIds[0],
      );
    } finally {
      await app.close();
    }
  });

  it('关键词只匹配旅程名称，并支持按所属活动筛选', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const firstCampaign = await createCampaign('活动一');
      const secondCampaign = await createCampaign('活动二');
      await createJourney(firstCampaign, '浏览挽回提醒');
      await createJourney(firstCampaign, '价格观察', { description: '浏览挽回相关的说明' });
      await createJourney(secondCampaign, '浏览挽回提醒');

      const byName = await listStats(app, cookie, '?q=%E6%B5%8F%E8%A7%88%E6%8C%BD%E5%9B%9E');
      expect(byName.statusCode).toBe(200);
      expect(byName.json().page.total).toBe(2);
      expect(
        byName
          .json()
          .data.map((item: { campaign: { name: string } }) => item.campaign.name)
          .sort(),
      ).toEqual(['活动一', '活动二']);

      const byCampaign = await listStats(app, cookie, `?campaignId=${firstCampaign}`);
      expect(byCampaign.json().page.total).toBe(2);
      expect(
        byCampaign
          .json()
          .data.map((item: { name: string }) => item.name)
          .sort(),
      ).toEqual(['价格观察', '浏览挽回提醒']);

      // 两个条件同时生效。
      const both = await listStats(
        app,
        cookie,
        `?campaignId=${secondCampaign}&q=%E6%B5%8F%E8%A7%88%E6%8C%BD%E5%9B%9E`,
      );
      expect(both.json().page.total).toBe(1);
      expect(both.json().data[0].campaign.id).toBe(secondCampaign);
    } finally {
      await app.close();
    }
  });

  it('百分号和下划线按字面匹配，不做通配', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const campaign = await createCampaign('通配符活动');
      await createJourney(campaign, '100%优惠');
      await createJourney(campaign, '100元优惠');
      await createJourney(campaign, 'A_B 测试');
      await createJourney(campaign, 'AXB 测试');

      const percent = await listStats(app, cookie, '?q=100%25');
      expect(percent.json().page.total).toBe(1);
      expect(percent.json().data[0].name).toBe('100%优惠');

      const underscore = await listStats(app, cookie, '?q=A_B');
      expect(underscore.json().page.total).toBe(1);
      expect(underscore.json().data[0].name).toBe('A_B 测试');
    } finally {
      await app.close();
    }
  });

  it('按更新时间倒序排列，同一时间按标识倒序；越界页码夹到末页，空结果回到第一页', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const campaign = await createCampaign('排序活动');
      const older = await createJourney(campaign, '较早的旅程', {
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      });
      const newer = await createJourney(campaign, '较新的旅程', {
        updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      });
      const sameTimeFirst = await createJourney(campaign, '同刻旅程一', {
        updatedAt: new Date('2026-07-03T00:00:00.000Z'),
      });
      const sameTimeSecond = await createJourney(campaign, '同刻旅程二', {
        updatedAt: new Date('2026-07-03T00:00:00.000Z'),
      });

      const firstPage = await listStats(app, cookie);
      const ids = firstPage.json().data.map((item: { id: string }) => item.id);
      const sameTimeExpected = [sameTimeFirst.journeyId, sameTimeSecond.journeyId].sort().reverse();
      expect(ids).toEqual([...sameTimeExpected, newer.journeyId, older.journeyId]);

      // 每页 10 条时 4 条数据只有 1 页，请求第 9 页应落到第 1 页。
      const beyond = await listStats(app, cookie, '?page=9');
      expect(beyond.json().page).toEqual({ page: 1, pageSize: 10, total: 4 });

      // 搜索无结果时页码回到 1，分页元信息仍然是合法页码。
      const empty = await listStats(app, cookie, '?q=%E4%B8%8D%E5%AD%98%E5%9C%A8&page=3');
      expect(empty.json()).toEqual({
        data: [],
        page: { page: 1, pageSize: 10, total: 0 },
      });
    } finally {
      await app.close();
    }
  });

  it('每页条数只接受 10/20/50，并如实返回总条数与当前页', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const campaign = await createCampaign('分页活动');
      for (let index = 1; index <= 12; index += 1) {
        await createJourney(campaign, `分页旅程 ${index}`, {
          updatedAt: new Date(`2026-07-${String(index).padStart(2, '0')}T00:00:00.000Z`),
        });
      }

      const secondPage = await listStats(app, cookie, '?page=2&pageSize=10');
      expect(secondPage.json().page).toEqual({ page: 2, pageSize: 10, total: 12 });
      expect(secondPage.json().data).toHaveLength(2);

      const thirdPage = await listStats(app, cookie, '?page=3&pageSize=20');
      expect(thirdPage.json().page).toEqual({ page: 1, pageSize: 20, total: 12 });
      expect(thirdPage.json().data).toHaveLength(12);
    } finally {
      await app.close();
    }
  });
});
