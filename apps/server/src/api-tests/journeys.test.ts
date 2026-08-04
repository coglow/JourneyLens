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

afterEach(() => {
  vi.restoreAllMocks();
});

const missingId = '00000000-0000-4000-8000-000000000099';
const campaignAId = '00000000-0000-4000-8200-000000000001';
const campaignBId = '00000000-0000-4000-8200-000000000002';
const segmentAId = '00000000-0000-4000-8201-000000000001';
const segmentBId = '00000000-0000-4000-8201-000000000002';
const segmentCId = '00000000-0000-4000-8201-000000000003';
const emptyCampaignId = '00000000-0000-4000-8200-000000000003';

const vipRule = {
  kind: 'compare',
  left: { source: 'user', path: 'vipLevel' },
  operator: 'in',
  right: ['gold', 'platinum'],
};

const ageRule = {
  kind: 'compare',
  left: { source: 'user', path: 'age' },
  operator: 'gte',
  right: 18,
};

// 五类节点各出现一次：开始 → 属性分支（满足发邮件、不满足等待后发邮件）→ 结束。
const draftDefinition = {
  layoutDirection: 'vertical' as const,
  nodes: [
    {
      id: 'n-start',
      type: 'start',
      name: '开始',
      position: { x: 0, y: 0 },
      entryBehavior: 'app_session_started',
    },
    {
      id: 'n-condition',
      type: 'condition',
      name: '高价值用户',
      position: { x: 0, y: 120 },
      rules: vipRule,
    },
    {
      id: 'n-wait',
      type: 'wait',
      name: '等待一天',
      position: { x: -220, y: 240 },
      waitSeconds: 86_400,
    },
    {
      id: 'n-message',
      type: 'message',
      name: '发送欢迎邮件',
      position: { x: 220, y: 240 },
      channel: 'email',
      subject: '欢迎回来',
      body: '这是一封欢迎邮件',
    },
    {
      id: 'n-end',
      type: 'end',
      name: '结束',
      position: { x: 0, y: 360 },
      note: '完成触达',
    },
  ],
  edges: [
    { id: 'e-start', source: 'n-start', target: 'n-condition' },
    { id: 'e-met', source: 'n-condition', target: 'n-message', branch: 'met' },
    { id: 'e-unmet', source: 'n-condition', target: 'n-wait', branch: 'unmet' },
    { id: 'e-wait', source: 'n-wait', target: 'n-message' },
    { id: 'e-end', source: 'n-message', target: 'n-end' },
  ],
};

async function seedCampaign(
  id: string,
  name: string,
  status: 'draft' | 'paused' | 'running' | 'stopped' = 'draft',
): Promise<void> {
  await db.prisma.campaign.create({
    data: { id, name, status, createdById: testAccountId, createdAt: testNow, updatedAt: testNow },
  });
}

async function seedSegment(
  id: string,
  name: string,
  rules: unknown = vipRule,
  revision = 1,
): Promise<void> {
  await db.prisma.segment.create({
    data: {
      id,
      name,
      rules: rules as Prisma.InputJsonValue,
      revision,
      createdById: testAccountId,
      updatedById: testAccountId,
    },
  });
}

function listJourneys(app: TestApp, cookie: string, campaignId: string, query = '') {
  return app.inject({
    method: 'GET',
    url: `/api/campaigns/${campaignId}/journeys${query}`,
    headers: { cookie },
  });
}

function createJourney(
  app: TestApp,
  cookie: string,
  campaignId: string,
  payload: unknown,
  origin = 'http://localhost',
) {
  return app.inject({
    method: 'POST',
    url: `/api/campaigns/${campaignId}/journeys`,
    headers: { ...jsonHeaders(cookie), origin },
    payload: JSON.stringify(payload),
  });
}

function patchJourney(
  app: TestApp,
  cookie: string,
  id: string,
  payload: unknown,
  origin = 'http://localhost',
) {
  return app.inject({
    method: 'PATCH',
    url: `/api/journeys/${id}`,
    headers: { ...jsonHeaders(cookie), origin },
    payload: JSON.stringify(payload),
  });
}

function draftWithMessageBody(body: string) {
  return {
    ...draftDefinition,
    nodes: draftDefinition.nodes.map((node) =>
      node.id === 'n-message' ? { ...node, body } : node,
    ),
  };
}

function putJourneyDraft(
  app: TestApp,
  cookie: string,
  id: string,
  payload: unknown,
  origin = 'http://localhost',
) {
  return app.inject({
    method: 'PUT',
    url: `/api/journeys/${id}/draft`,
    headers: { ...jsonHeaders(cookie), origin },
    payload: JSON.stringify(payload),
  });
}

function deleteJourney(app: TestApp, cookie: string, id: string, origin = 'http://localhost') {
  return app.inject({
    method: 'DELETE',
    url: `/api/journeys/${id}`,
    headers: { host: 'localhost', origin, cookie },
  });
}

function deleteCampaign(app: TestApp, cookie: string, id: string) {
  return app.inject({
    method: 'DELETE',
    url: `/api/campaigns/${id}`,
    headers: { host: 'localhost', origin: 'http://localhost', cookie },
  });
}

function deleteSegment(app: TestApp, cookie: string, id: string) {
  return app.inject({
    method: 'DELETE',
    url: `/api/segments/${id}`,
    headers: { host: 'localhost', origin: 'http://localhost', cookie },
  });
}

/** 断言请求在指定时间内没有返回，说明它确实停在数据库写入上，而不是已经处理完。 */
async function expectRequestBlocked(request: Promise<unknown>): Promise<void> {
  let settled = false;
  void Promise.resolve(request).then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(settled).toBe(false);
}

describe('旅程 API', () => {
  it('创建不绑定分群的旅程，同一活动多个旅程可复用同一分群', async () => {
    await seedCampaign(campaignAId, '验收活动');
    await seedSegment(segmentAId, '高价值会员');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const unbound = await createJourney(app, cookie, campaignAId, {
        name: '  新客欢迎  ',
        description: '  ',
      });
      expect(unbound.statusCode).toBe(201);
      expect(unbound.json().data).toMatchObject({
        name: '新客欢迎',
        description: null,
        revision: 1,
        campaign: { id: campaignAId, name: '验收活动', status: 'draft' },
        segment: null,
        createdBy: { id: testAccountId, displayName: '测试运营账号' },
        updatedBy: { id: testAccountId, displayName: '测试运营账号' },
      });
      const unboundId = unbound.json().data.id as string;

      const bound = await createJourney(app, cookie, campaignAId, {
        name: '高价值回访',
        description: '针对高价值会员',
        segmentId: segmentAId,
      });
      expect(bound.statusCode).toBe(201);
      expect(bound.json().data).toMatchObject({
        name: '高价值回访',
        description: '针对高价值会员',
        segment: { id: segmentAId, name: '高价值会员', revision: 1, rules: vipRule },
      });

      const reused = await createJourney(app, cookie, campaignAId, {
        name: '高价值二次触达',
        segmentId: segmentAId,
      });
      expect(reused.statusCode).toBe(201);
      expect(reused.json().data.segment.id).toBe(segmentAId);

      const stored = await db.prisma.journey.findUnique({ where: { id: unboundId } });
      expect(stored).toMatchObject({ campaignId: campaignAId, segmentId: null, name: '新客欢迎' });

      const listed = await listJourneys(app, cookie, campaignAId);
      expect(listed.statusCode).toBe(200);
      expect(listed.json().page).toEqual({ page: 1, pageSize: 10, total: 3 });
      expect(
        listed
          .json()
          .data.map((item: { name: string }) => item.name)
          .sort(),
      ).toEqual(['新客欢迎', '高价值二次触达', '高价值回访'].sort());

      // 列表要直接给出说明，页面按列展示时无需为每行再读详情。
      const listItems = listed.json().data as Array<{ name: string; description: string | null }>;
      expect(listItems.find((item) => item.name === '高价值回访')?.description).toBe(
        '针对高价值会员',
      );
      expect(listItems.find((item) => item.name === '新客欢迎')?.description).toBeNull();
      // 未发布过的旅程版本数量为 0，删除操作保持可用。
      const versionCounts = listed.json().data as Array<{ versionCount: number }>;
      expect(versionCounts.map((item) => item.versionCount)).toEqual([0, 0, 0]);

      const detail = await app.inject({
        method: 'GET',
        url: `/api/journeys/${bound.json().data.id}`,
        headers: { cookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toEqual({ data: bound.json().data });

      const missingCampaign = await listJourneys(app, cookie, missingId);
      expect(missingCampaign.statusCode).toBe(404);
      expect(missingCampaign.json().error.message).toBe('活动不存在');
    } finally {
      await app.close();
    }
  });

  it('列表分页、越界页码、稳定排序和按名称说明搜索都返回真实数据', async () => {
    await seedCampaign(campaignAId, '分页活动');
    await seedCampaign(campaignBId, '同刻排序活动');
    await seedCampaign(emptyCampaignId, '空活动');
    await db.prisma.journey.createMany({
      data: Array.from({ length: 23 }, (_, index) => ({
        id: `00000000-0000-4000-8202-${String(index + 1).padStart(12, '0')}`,
        campaignId: campaignAId,
        segmentId: null,
        name: `旅程 ${String(index + 1).padStart(2, '0')}`,
        description: index === 4 ? '含百分号 100% 的活动' : null,
        createdById: testAccountId,
        updatedById: testAccountId,
        createdAt: new Date(testNow.getTime() + index * 1000),
        updatedAt: new Date(testNow.getTime() + index * 1000),
      })),
    });
    // 同一更新时间只能靠 id 保证稳定顺序。
    await db.prisma.journey.createMany({
      data: [
        {
          id: '00000000-0000-4000-8202-000000000201',
          campaignId: campaignBId,
          segmentId: null,
          name: '同刻旅程 A',
          createdById: testAccountId,
          updatedById: testAccountId,
          createdAt: testNow,
          updatedAt: testNow,
        },
        {
          id: '00000000-0000-4000-8202-000000000202',
          campaignId: campaignBId,
          segmentId: null,
          name: '同刻旅程 B',
          createdById: testAccountId,
          updatedById: testAccountId,
          createdAt: testNow,
          updatedAt: testNow,
        },
      ],
    });
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const names = (start: number, end: number) =>
        Array.from(
          { length: end - start + 1 },
          (_, index) => `旅程 ${String(end - index).padStart(2, '0')}`,
        );

      const first = await listJourneys(app, cookie, campaignAId);
      expect(first.json().page).toEqual({ page: 1, pageSize: 10, total: 23 });
      expect(first.json().data.map((item: { name: string }) => item.name)).toEqual(names(14, 23));

      const second = await listJourneys(app, cookie, campaignAId, '?page=2&pageSize=10');
      expect(second.json().page).toEqual({ page: 2, pageSize: 10, total: 23 });
      expect(second.json().data.map((item: { name: string }) => item.name)).toEqual(names(4, 13));

      const fifty = await listJourneys(app, cookie, campaignAId, '?page=1&pageSize=50');
      expect(fifty.json().data).toHaveLength(23);

      const outOfRange = await listJourneys(app, cookie, campaignAId, '?page=99&pageSize=10');
      expect(outOfRange.json().page).toEqual({ page: 3, pageSize: 10, total: 23 });
      expect(outOfRange.json().data.map((item: { name: string }) => item.name)).toEqual(
        names(1, 3),
      );

      const byName = await listJourneys(app, cookie, campaignAId, '?q=%E6%97%85%E7%A8%8B%202');
      expect(byName.json().page.total).toBe(4);

      const byDescription = await listJourneys(
        app,
        cookie,
        campaignAId,
        '?q=%E7%99%BE%E5%88%86%E5%8F%B7',
      );
      expect(byDescription.json().page.total).toBe(1);
      expect(byDescription.json().data[0].name).toBe('旅程 05');

      const percent = await listJourneys(app, cookie, campaignAId, '?q=100%25');
      expect(percent.json().page.total).toBe(1);

      const stable = await listJourneys(app, cookie, campaignBId, '?pageSize=50');
      expect(stable.json().data.map((item: { name: string }) => item.name)).toEqual([
        '同刻旅程 B',
        '同刻旅程 A',
      ]);

      const empty = await listJourneys(app, cookie, emptyCampaignId, '?page=3&pageSize=10');
      expect(empty.statusCode).toBe(200);
      expect(empty.json()).toEqual({
        data: [],
        page: { page: 1, pageSize: 10, total: 0 },
      });

      for (const [query, message] of [
        ['?page=0', '页码必须是正整数'],
        ['?page=1.5', '页码必须是正整数'],
        ['?pageSize=5', '每页条数只能选择 10、20 或 50 条'],
        ['?page=0&pageSize=5', '页码必须是正整数；每页条数只能选择 10、20 或 50 条'],
        [`?q=${'x'.repeat(101)}`, '搜索词最多 100 个字符'],
      ]) {
        const invalid = await listJourneys(app, cookie, campaignAId, query);
        expect(invalid.statusCode).toBe(400);
        expect(invalid.json().error.message).toBe(message);
      }
    } finally {
      await app.close();
    }
  });

  it('名称去除首尾空格，同活动重名被拒绝，跨活动可以同名', async () => {
    await seedCampaign(campaignAId, '活动 A');
    await seedCampaign(campaignBId, '活动 B');
    await seedSegment(segmentAId, '可用分群');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createJourney(app, cookie, campaignAId, { name: '  新客旅程  ' });
      expect(created.statusCode).toBe(201);
      expect(created.json().data.name).toBe('新客旅程');
      expect(
        (await db.prisma.journey.findUnique({ where: { id: created.json().data.id } }))?.name,
      ).toBe('新客旅程');

      const duplicate = await createJourney(app, cookie, campaignAId, { name: ' 新客旅程 ' });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().error).toMatchObject({
        code: 'JOURNEY_NAME_TAKEN',
        message: '该活动内已有同名旅程',
      });

      const otherCampaign = await createJourney(app, cookie, campaignBId, { name: '新客旅程' });
      expect(otherCampaign.statusCode).toBe(201);

      for (const payload of [
        { name: '' },
        { name: '   ' },
        { name: 'x'.repeat(181) },
        { name: '有效名称', description: 'x'.repeat(4001) },
        { name: '有效名称', segmentId: 'not-a-uuid' },
        { name: '有效名称', segmentId: missingId },
        { name: '有效名称', extra: true },
      ]) {
        expect((await createJourney(app, cookie, campaignAId, payload)).statusCode).toBe(400);
      }

      const missingSegment = await createJourney(app, cookie, campaignAId, {
        name: '不存在的分群',
        segmentId: missingId,
      });
      expect(missingSegment.statusCode).toBe(400);
      expect(missingSegment.json().error.code).toBe('SEGMENT_NOT_FOUND');

      const missingCampaign = await createJourney(app, cookie, missingId, { name: '没有活动' });
      expect(missingCampaign.statusCode).toBe(404);

      expect(
        (await createJourney(app, cookie, 'not-a-uuid', { name: '非法活动' })).statusCode,
      ).toBe(400);
      expect(await db.prisma.journey.count()).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('编辑可清空说明、更换和解除分群，过期修订号不覆盖已有内容', async () => {
    await seedCampaign(campaignAId, '编辑活动');
    await seedSegment(segmentAId, '分群 A');
    await seedSegment(segmentBId, '分群 B', ageRule);
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createJourney(app, cookie, campaignAId, {
        name: '原旅程',
        description: '原说明',
        segmentId: segmentAId,
      });
      const id = created.json().data.id as string;

      const updated = await patchJourney(app, cookie, id, {
        revision: 1,
        name: '  改名后的旅程  ',
        description: '  ',
        segmentId: segmentBId,
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().data).toMatchObject({
        id,
        name: '改名后的旅程',
        description: null,
        revision: 2,
        campaign: { id: campaignAId, name: '编辑活动', status: 'draft' },
        segment: { id: segmentBId, name: '分群 B', revision: 1, rules: ageRule },
      });

      const stale = await patchJourney(app, cookie, id, { revision: 1, name: '过期修改' });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toMatchObject({
        code: 'JOURNEY_REVISION_CONFLICT',
        message: '旅程已被修改，请重新读取后再保存',
      });
      expect((await db.prisma.journey.findUnique({ where: { id } }))?.name).toBe('改名后的旅程');

      const unbound = await patchJourney(app, cookie, id, { revision: 2, segmentId: null });
      expect(unbound.statusCode).toBe(200);
      expect(unbound.json().data.segment).toBeNull();
      expect(unbound.json().data.revision).toBe(3);

      const rebound = await patchJourney(app, cookie, id, { revision: 3, segmentId: segmentAId });
      expect(rebound.statusCode).toBe(200);
      expect(rebound.json().data.segment.id).toBe(segmentAId);

      const renamed = await patchJourney(app, cookie, id, { revision: 4, name: '只改名称' });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json().data).toMatchObject({
        name: '只改名称',
        description: null,
        revision: 5,
        segment: { id: segmentAId },
      });

      const unchanged = await db.prisma.journey.findUnique({ where: { id } });
      expect(unchanged).toMatchObject({ revision: 5, segmentId: segmentAId, description: null });

      for (const payload of [
        {},
        { revision: 5 },
        { revision: 0, name: '修改' },
        { revision: 5, name: '   ' },
        { revision: 5, name: '修改', extra: true },
        { revision: 5, segmentId: 'not-a-uuid' },
      ]) {
        expect((await patchJourney(app, cookie, id, payload)).statusCode).toBe(400);
      }

      const missingSegment = await patchJourney(app, cookie, id, {
        revision: 5,
        segmentId: missingId,
      });
      expect(missingSegment.statusCode).toBe(400);
      expect(missingSegment.json().error.code).toBe('SEGMENT_NOT_FOUND');
      expect((await db.prisma.journey.findUnique({ where: { id } }))?.revision).toBe(5);

      expect(
        (await patchJourney(app, cookie, missingId, { revision: 1, name: '不存在' })).statusCode,
      ).toBe(404);
      expect(
        (await patchJourney(app, cookie, 'not-a-uuid', { revision: 1, name: '非法' })).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('另一人接着保存时，先前保存的响应仍返回自己的内容和修订号', async () => {
    await seedCampaign(campaignAId, '并发保存活动');
    await seedSegment(segmentAId, '甲选择的分群');
    await seedSegment(segmentBId, '乙选择的分群');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createJourney(app, cookie, campaignAId, { name: '原旅程' });
      const id = created.json().data.id as string;

      // 甲的事务提交后、响应返回前，让乙读取最新内容并完成保存：甲仍返回自己写入的结果。
      const runTransaction = db.prisma.$transaction.bind(db.prisma) as (
        fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) => Promise<unknown>;
      vi.spyOn(db.prisma, '$transaction').mockImplementationOnce(((
        fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) =>
        runTransaction(fn).then(async (result) => {
          const latest = await app.inject({
            method: 'GET',
            url: `/api/journeys/${id}`,
            headers: { cookie },
          });
          expect(latest.statusCode).toBe(200);
          const second = await patchJourney(app, cookie, id, {
            revision: latest.json().data.revision,
            name: '乙的修改',
            segmentId: segmentBId,
          });
          expect(second.statusCode).toBe(200);
          expect(second.json().data).toMatchObject({ name: '乙的修改', revision: 3 });
          return result;
        })) as unknown as typeof db.prisma.$transaction);

      const first = await patchJourney(app, cookie, id, {
        revision: 1,
        name: '甲的修改',
        segmentId: segmentAId,
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().data).toMatchObject({
        name: '甲的修改',
        revision: 2,
        segment: { id: segmentAId },
      });
      expect(await db.prisma.journey.findUnique({ where: { id } })).toMatchObject({
        name: '乙的修改',
        revision: 3,
        segmentId: segmentBId,
      });
    } finally {
      await app.close();
    }
  });

  it('旅程在保存前被删除时，仍明确返回不存在', async () => {
    await seedCampaign(campaignAId, '保存期间删除活动');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createJourney(app, cookie, campaignAId, { name: '即将删除的旅程' });
      const id = created.json().data.id as string;

      // 服务读到旅程后，写入会停在旅程行锁上；此时在事务内删除，提交后写入条件落空。
      let locked!: () => void;
      const lockAcquired = new Promise<void>((resolve) => {
        locked = resolve;
      });
      let release!: () => void;
      const holdLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      const deleting = db.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "journeys" WHERE "id" = ${id}::uuid FOR UPDATE`;
        locked();
        await holdLock;
        await tx.journey.delete({ where: { id } });
      });
      await lockAcquired;

      const pending = patchJourney(app, cookie, id, { revision: 1, name: '无法保存的修改' });
      await expectRequestBlocked(pending);

      release();
      await deleting;

      const response = await pending;
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toMatchObject({ code: 'NOT_FOUND', message: '旅程不存在' });
    } finally {
      await app.close();
    }
  });

  it('修改被引用的分群后，旅程读取到当前名称和规则，不保存规则副本', async () => {
    await seedCampaign(campaignAId, '关联活动');
    await seedSegment(segmentAId, '原分群名');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createJourney(app, cookie, campaignAId, {
        name: '引用旅程',
        segmentId: segmentAId,
      });
      const id = created.json().data.id as string;

      const segmentUpdated = await app.inject({
        method: 'PATCH',
        url: `/api/segments/${segmentAId}`,
        headers: jsonHeaders(cookie),
        payload: { revision: 1, name: '新分群名', rules: ageRule },
      });
      expect(segmentUpdated.statusCode).toBe(200);
      expect(segmentUpdated.json().data.revision).toBe(2);

      const detail = await app.inject({
        method: 'GET',
        url: `/api/journeys/${id}`,
        headers: { cookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data).toMatchObject({
        revision: 1,
        segment: { id: segmentAId, name: '新分群名', revision: 2, rules: ageRule },
      });

      const listed = await listJourneys(app, cookie, campaignAId);
      expect(listed.json().data[0].segment).toEqual({ id: segmentAId, name: '新分群名' });

      const stored = await db.prisma.journey.findUnique({ where: { id } });
      expect(stored).toMatchObject({ revision: 1, segmentId: segmentAId });
      expect(Object.keys(stored ?? {})).not.toContain('rules');
    } finally {
      await app.close();
    }
  });

  it('被引用的分群不能删除，解除全部绑定后可以删除', async () => {
    await seedCampaign(campaignAId, '引用保护活动');
    await seedSegment(segmentAId, '被引用分群');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const first = await createJourney(app, cookie, campaignAId, {
        name: '旅程一',
        segmentId: segmentAId,
      });
      const second = await createJourney(app, cookie, campaignAId, {
        name: '旅程二',
        segmentId: segmentAId,
      });

      const blocked = await deleteSegment(app, cookie, segmentAId);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error).toMatchObject({
        code: 'SEGMENT_IN_USE',
        message: '分群正在被旅程使用，请先更换或解除关联',
      });
      expect(await db.prisma.segment.count({ where: { id: segmentAId } })).toBe(1);
      expect(await db.prisma.journey.count()).toBe(2);

      expect(
        (await patchJourney(app, cookie, first.json().data.id, { revision: 1, segmentId: null }))
          .statusCode,
      ).toBe(200);
      expect((await deleteSegment(app, cookie, segmentAId)).statusCode).toBe(409);

      expect(
        (await patchJourney(app, cookie, second.json().data.id, { revision: 1, segmentId: null }))
          .statusCode,
      ).toBe(200);
      expect((await deleteSegment(app, cookie, segmentAId)).statusCode).toBe(204);
      expect(await db.prisma.segment.count({ where: { id: segmentAId } })).toBe(0);
      expect(await db.prisma.journey.count()).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('活动中还有旅程时不能删除，删除旅程后草稿活动可以删除', async () => {
    await seedCampaign(campaignAId, '待删活动');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createJourney(app, cookie, campaignAId, { name: '待删旅程' });
      const id = created.json().data.id as string;

      const blocked = await deleteCampaign(app, cookie, campaignAId);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error).toMatchObject({
        code: 'CAMPAIGN_HAS_JOURNEYS',
        message: '活动中还有旅程，请先删除旅程',
      });
      expect(await db.prisma.campaign.count({ where: { id: campaignAId } })).toBe(1);
      expect(await db.prisma.journey.count()).toBe(1);

      expect((await deleteJourney(app, cookie, id)).statusCode).toBe(204);
      expect(await db.prisma.journey.count()).toBe(0);
      expect((await deleteCampaign(app, cookie, campaignAId)).statusCode).toBe(204);
      expect(await db.prisma.campaign.count({ where: { id: campaignAId } })).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('非草稿活动的旅程只读，不能创建、修改或删除', async () => {
    await seedCampaign(campaignAId, '进行中活动', 'running');
    const journeyId = '00000000-0000-4000-8202-000000000301';
    await db.prisma.journey.create({
      data: {
        id: journeyId,
        campaignId: campaignAId,
        name: '只读旅程',
        createdById: testAccountId,
        updatedById: testAccountId,
      },
    });
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);

      const listed = await listJourneys(app, cookie, campaignAId);
      expect(listed.statusCode).toBe(200);
      expect(listed.json().data).toHaveLength(1);

      const detail = await app.inject({
        method: 'GET',
        url: `/api/journeys/${journeyId}`,
        headers: { cookie },
      });
      expect(detail.statusCode).toBe(200);

      const created = await createJourney(app, cookie, campaignAId, { name: '不该创建' });
      expect(created.statusCode).toBe(409);
      expect(created.json().error).toMatchObject({
        code: 'CAMPAIGN_NOT_EDITABLE',
        message: '只有草稿或已暂停的活动可以新建旅程',
      });

      const patched = await patchJourney(app, cookie, journeyId, { revision: 1, name: '不该修改' });
      expect(patched.statusCode).toBe(409);
      expect(patched.json().error).toMatchObject({
        code: 'CAMPAIGN_NOT_EDITABLE',
        message: '只有草稿或已暂停的活动可以修改旅程',
      });

      const deleted = await deleteJourney(app, cookie, journeyId);
      expect(deleted.statusCode).toBe(409);
      expect(deleted.json().error).toMatchObject({
        code: 'CAMPAIGN_NOT_EDITABLE',
        message: '只有草稿或已暂停的活动可以删除旅程',
      });

      expect(await db.prisma.journey.count()).toBe(1);
      expect((await db.prisma.journey.findUnique({ where: { id: journeyId } }))?.revision).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('暂停活动允许新建、修改、保存和删除未发布旅程', async () => {
    await seedCampaign(campaignAId, '已暂停活动', 'paused');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);

      const created = await createJourney(app, cookie, campaignAId, { name: '暂停期间新建' });
      expect(created.statusCode).toBe(201);
      expect(created.json().data.campaign).toMatchObject({ status: 'paused' });
      const id = created.json().data.id as string;

      const saved = await putJourneyDraft(app, cookie, id, { revision: 1, draftDefinition });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().data).toMatchObject({ revision: 2, draftDefinition });

      const patched = await patchJourney(app, cookie, id, { revision: 2, name: '暂停期间改名' });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().data.name).toBe('暂停期间改名');

      // 从未发布：可以删掉误建的旅程。
      expect((await deleteJourney(app, cookie, id)).statusCode).toBe(204);
      expect(await db.prisma.journey.count({ where: { id } })).toBe(0);

      // 已有发布版本：即使当前是暂停也不能删除。
      const published = await createJourney(app, cookie, campaignAId, { name: '已有版本旅程' });
      const publishedId = published.json().data.id as string;
      await db.prisma.journeyVersion.create({
        data: {
          journeyId: publishedId,
          versionNumber: 1,
          sourceRevision: 1,
          sourceSegmentRevision: null,
          snapshot: {
            name: '已有版本旅程',
            description: null,
            entrySegment: null,
            definition: draftDefinition,
          } as unknown as Prisma.InputJsonValue,
          publishedById: testAccountId,
          publishedAt: testNow,
        },
      });
      const blocked = await deleteJourney(app, cookie, publishedId);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error).toMatchObject({
        code: 'JOURNEY_HAS_VERSIONS',
        message: '该旅程已有发布版本，不能删除',
      });
    } finally {
      await app.close();
    }
  });

  it('分群引用列表返回旅程和所属活动，支持分页且不隐藏非草稿活动', async () => {
    await seedCampaign(campaignAId, '草稿活动');
    await seedCampaign(campaignBId, '进行中活动', 'running');
    await seedSegment(segmentAId, '被引用分群');
    await seedSegment(segmentBId, '另一分群');
    await seedSegment(segmentCId, '未被引用分群');
    await db.prisma.journey.createMany({
      data: [
        {
          id: '00000000-0000-4000-8202-000000000401',
          campaignId: campaignAId,
          segmentId: segmentAId,
          name: '旅程一',
          createdById: testAccountId,
          updatedById: testAccountId,
          createdAt: testNow,
          updatedAt: new Date(testNow.getTime() + 1000),
        },
        {
          id: '00000000-0000-4000-8202-000000000402',
          campaignId: campaignAId,
          segmentId: segmentAId,
          name: '旅程二',
          createdById: testAccountId,
          updatedById: testAccountId,
          createdAt: testNow,
          updatedAt: new Date(testNow.getTime() + 2000),
        },
        {
          id: '00000000-0000-4000-8202-000000000403',
          campaignId: campaignBId,
          segmentId: segmentAId,
          name: '进行中活动旅程',
          createdById: testAccountId,
          updatedById: testAccountId,
          createdAt: testNow,
          updatedAt: new Date(testNow.getTime() + 3000),
        },
        {
          id: '00000000-0000-4000-8202-000000000404',
          campaignId: campaignAId,
          segmentId: segmentBId,
          name: '另一分群旅程',
          createdById: testAccountId,
          updatedById: testAccountId,
          createdAt: testNow,
          updatedAt: testNow,
        },
      ],
    });
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const usages = await app.inject({
        method: 'GET',
        url: `/api/segments/${segmentAId}/usages`,
        headers: { cookie },
      });
      expect(usages.statusCode).toBe(200);
      expect(usages.json().page).toEqual({ page: 1, pageSize: 10, total: 3 });
      expect(usages.json().data[0]).toEqual({
        journey: { id: '00000000-0000-4000-8202-000000000403', name: '进行中活动旅程' },
        campaign: { id: campaignBId, name: '进行中活动', status: 'running' },
        updatedAt: new Date(testNow.getTime() + 3000).toISOString(),
      });
      expect(
        usages.json().data.map((item: { journey: { name: string } }) => item.journey.name),
      ).toEqual(['进行中活动旅程', '旅程二', '旅程一']);

      const paged = await app.inject({
        method: 'GET',
        url: `/api/segments/${segmentAId}/usages?page=2&pageSize=10`,
        headers: { cookie },
      });
      expect(paged.json().page).toEqual({ page: 1, pageSize: 10, total: 3 });

      const empty = await app.inject({
        method: 'GET',
        url: `/api/segments/${segmentCId}/usages?page=4&pageSize=10`,
        headers: { cookie },
      });
      expect(empty.json()).toEqual({
        data: [],
        page: { page: 1, pageSize: 10, total: 0 },
      });

      const missing = await app.inject({
        method: 'GET',
        url: `/api/segments/${missingId}/usages`,
        headers: { cookie },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.message).toBe('分群不存在');

      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/segments/not-a-uuid/usages',
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(400);
      const invalidPage = await app.inject({
        method: 'GET',
        url: `/api/segments/${segmentAId}/usages?pageSize=5`,
        headers: { cookie },
      });
      expect(invalidPage.statusCode).toBe(400);
      expect(invalidPage.json().error.message).toBe('每页条数只能选择 10、20 或 50 条');
    } finally {
      await app.close();
    }
  });

  it('绑定与删除竞争时由数据库外键阻止失效引用', async () => {
    await seedCampaign(campaignAId, '竞争活动');
    await seedSegment(segmentAId, '即将删除的分群');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);

      // 服务确认分群存在后，写入会停在分群外键检查上；此时删除分群，引用无法建立。
      let locked!: () => void;
      const lockAcquired = new Promise<void>((resolve) => {
        locked = resolve;
      });
      let release!: () => void;
      const holdLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      const deleting = db.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "segments" WHERE "id" = ${segmentAId}::uuid FOR UPDATE`;
        locked();
        await holdLock;
        await tx.segment.delete({ where: { id: segmentAId } });
      });
      await lockAcquired;

      const pending = createJourney(app, cookie, campaignAId, {
        name: '竞争写入旅程',
        segmentId: segmentAId,
      });
      await expectRequestBlocked(pending);

      release();
      await deleting;

      const created = await pending;
      expect(created.statusCode).toBe(409);
      expect(created.json().error.code).toBe('JOURNEY_ASSOCIATION_MISSING');
      expect(await db.prisma.journey.count()).toBe(0);

      await seedSegment(segmentBId, '直接写入检查');
      await expect(
        db.prisma.journey.create({
          data: {
            campaignId: campaignAId,
            segmentId: segmentBId,
            name: '绕过服务写入',
            createdById: testAccountId,
            updatedById: testAccountId,
          },
        }),
      ).resolves.toBeDefined();
      await expect(
        db.prisma.journey.create({
          data: {
            campaignId: campaignAId,
            segmentId: segmentAId,
            name: '引用已删除分群',
            createdById: testAccountId,
            updatedById: testAccountId,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
      expect(await db.prisma.journey.count()).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('未登录和跨来源写请求被拒绝', async () => {
    await seedCampaign(campaignAId, '安全检查活动');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createJourney(app, cookie, campaignAId, { name: '安全检查旅程' });
      const id = created.json().data.id as string;
      const elsewhere = 'https://elsewhere.example';

      expect(
        (await app.inject({ method: 'GET', url: `/api/campaigns/${campaignAId}/journeys` }))
          .statusCode,
      ).toBe(401);
      expect((await app.inject({ method: 'GET', url: `/api/journeys/${id}` })).statusCode).toBe(
        401,
      );

      expect(
        (await createJourney(app, cookie, campaignAId, { name: '跨来源创建' }, elsewhere))
          .statusCode,
      ).toBe(403);
      expect(
        (await patchJourney(app, cookie, id, { revision: 1, name: '跨来源修改' }, elsewhere))
          .statusCode,
      ).toBe(403);
      expect((await deleteJourney(app, cookie, id, elsewhere)).statusCode).toBe(403);

      const unauthenticated = await app.inject({
        method: 'POST',
        url: `/api/campaigns/${campaignAId}/journeys`,
        headers: {
          host: 'localhost',
          origin: 'http://localhost',
          'content-type': 'application/json',
        },
        payload: { name: '未登录创建' },
      });
      expect(unauthenticated.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('不存在和数据库异常不会被伪装成成功', async () => {
    await seedCampaign(campaignAId, '异常活动');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);

      const missing = await app.inject({
        method: 'GET',
        url: `/api/journeys/${missingId}`,
        headers: { cookie },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.message).toBe('旅程不存在');
      expect(
        (await app.inject({ method: 'GET', url: '/api/journeys/not-a-uuid', headers: { cookie } }))
          .statusCode,
      ).toBe(400);
      expect((await deleteJourney(app, cookie, missingId)).statusCode).toBe(404);

      vi.spyOn(db.prisma.journey, 'findMany').mockRejectedValueOnce(
        new Error('database read failed'),
      );
      expect((await listJourneys(app, cookie, campaignAId)).statusCode).toBe(500);

      // 写入在事务内完成：事务整体失败时同样不能被伪装成成功。
      vi.spyOn(db.prisma, '$transaction').mockRejectedValueOnce(new Error('database write failed'));
      expect((await createJourney(app, cookie, campaignAId, { name: '写入失败' })).statusCode).toBe(
        500,
      );

      const created = await createJourney(app, cookie, campaignAId, { name: '更新失败旅程' });
      const id = created.json().data.id as string;
      vi.spyOn(db.prisma, '$transaction').mockRejectedValueOnce(new Error('database write failed'));
      expect(
        (await patchJourney(app, cookie, id, { revision: 1, name: '更新失败' })).statusCode,
      ).toBe(500);

      vi.spyOn(db.prisma, '$transaction').mockRejectedValueOnce(new Error('database write failed'));
      expect((await deleteJourney(app, cookie, id)).statusCode).toBe(500);
    } finally {
      await app.close();
    }
  });

  it('保存草稿后重新读取和数据库都得到同一份内容，修订号递增', async () => {
    await seedCampaign(campaignAId, '编排活动');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createJourney(app, cookie, campaignAId, { name: '编排旅程' });
      const id = created.json().data.id as string;
      // 新旅程没有编排内容，详情返回 null 而不是空对象。
      expect(created.json().data.draftDefinition).toBeNull();

      const saved = await putJourneyDraft(app, cookie, id, { revision: 1, draftDefinition });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().data).toMatchObject({
        id,
        revision: 2,
        draftDefinition,
        updatedBy: { id: testAccountId, displayName: '测试运营账号' },
      });

      const detail = await app.inject({
        method: 'GET',
        url: `/api/journeys/${id}`,
        headers: { cookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.draftDefinition).toEqual(draftDefinition);
      expect(detail.json().data.revision).toBe(2);

      const stored = await db.prisma.journey.findUnique({ where: { id } });
      expect(stored).toMatchObject({ revision: 2, updatedById: testAccountId });
      expect(stored?.draftDefinition).toEqual(draftDefinition);

      const listed = await listJourneys(app, cookie, campaignAId);
      expect(listed.statusCode).toBe(200);
      expect(listed.json().data[0]).toMatchObject({ name: '编排旅程' });
    } finally {
      await app.close();
    }
  });

  it('过期修订号拒绝覆盖，重新读取后可以继续保存', async () => {
    await seedCampaign(campaignAId, '顺序保存活动');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createJourney(app, cookie, campaignAId, { name: '顺序保存旅程' });
      const id = created.json().data.id as string;

      const first = await putJourneyDraft(app, cookie, id, { revision: 1, draftDefinition });
      expect(first.statusCode).toBe(200);
      expect(first.json().data.revision).toBe(2);

      const stale = await putJourneyDraft(app, cookie, id, {
        revision: 1,
        draftDefinition: draftWithMessageBody('过期内容'),
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toMatchObject({
        code: 'JOURNEY_REVISION_CONFLICT',
        message: '旅程已被修改，请重新读取后再保存',
      });

      const detail = await app.inject({
        method: 'GET',
        url: `/api/journeys/${id}`,
        headers: { cookie },
      });
      expect(detail.json().data).toMatchObject({ revision: 2, draftDefinition });

      const second = await putJourneyDraft(app, cookie, id, {
        revision: 2,
        draftDefinition: draftWithMessageBody('更新后的正文'),
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().data.revision).toBe(3);
      expect(second.json().data.draftDefinition.nodes[3].body).toBe('更新后的正文');
    } finally {
      await app.close();
    }
  });

  it('同一修订号的并发提交只有一个成功，另一个不会覆盖', async () => {
    await seedCampaign(campaignAId, '并发草稿活动');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createJourney(app, cookie, campaignAId, { name: '并发草稿旅程' });
      const id = created.json().data.id as string;
      const otherDefinition = draftWithMessageBody('另一个版本');

      const [first, second] = await Promise.all([
        putJourneyDraft(app, cookie, id, { revision: 1, draftDefinition }),
        putJourneyDraft(app, cookie, id, { revision: 1, draftDefinition: otherDefinition }),
      ]);
      const statuses = [first.statusCode, second.statusCode].sort((left, right) => left - right);
      expect(statuses).toEqual([200, 409]);

      const failed = first.statusCode === 409 ? first : second;
      expect(failed.json().error.code).toBe('JOURNEY_REVISION_CONFLICT');

      const winner = first.statusCode === 200 ? draftDefinition : otherDefinition;
      const stored = await db.prisma.journey.findUnique({ where: { id } });
      expect(stored?.revision).toBe(2);
      expect(stored?.draftDefinition).toEqual(winner);
    } finally {
      await app.close();
    }
  });

  it('结构无效的草稿被拒绝，数据库保持未保存状态', async () => {
    await seedCampaign(campaignAId, '非法草稿活动');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createJourney(app, cookie, campaignAId, { name: '非法草稿旅程' });
      const id = created.json().data.id as string;

      const start = {
        id: 'n-start',
        type: 'start',
        name: '开始',
        position: { x: 0, y: 0 },
        entryBehavior: 'product_viewed',
      };
      const end = {
        id: 'n-end',
        type: 'end',
        name: '结束',
        position: { x: 0, y: 200 },
        note: null,
      };
      const invalidPayloads: unknown[] = [
        { revision: 1, draftDefinition: { nodes: [], edges: [] } },
        { revision: 1, draftDefinition: { nodes: [start, { ...start }], edges: [] } },
        {
          revision: 1,
          draftDefinition: {
            nodes: [start, end],
            edges: [{ id: 'e', source: 'n-start', target: 'n-missing' }],
          },
        },
        {
          revision: 1,
          draftDefinition: {
            nodes: [start, end],
            edges: [{ id: 'e', source: 'n-start', target: 'n-start' }],
          },
        },
        {
          revision: 1,
          draftDefinition: {
            nodes: [
              start,
              {
                id: 'n-condition',
                type: 'condition',
                name: '条件',
                position: { x: 0, y: 100 },
                rules: vipRule,
              },
              end,
            ],
            edges: [
              { id: 'e1', source: 'n-start', target: 'n-condition' },
              { id: 'e2', source: 'n-condition', target: 'n-end' },
            ],
          },
        },
        {
          // 旅程条件只能是一条比较判断，组合结构不能保存。
          revision: 1,
          draftDefinition: {
            nodes: [
              start,
              {
                id: 'n-condition',
                type: 'condition',
                name: '条件',
                position: { x: 0, y: 100 },
                rules: { kind: 'all', children: [vipRule] },
              },
              end,
            ],
            edges: [
              { id: 'e1', source: 'n-start', target: 'n-condition' },
              { id: 'e2', source: 'n-condition', target: 'n-end', branch: 'met' },
            ],
          },
        },
        {
          revision: 1,
          draftDefinition: {
            nodes: [
              start,
              {
                id: 'n-a',
                type: 'message',
                name: '消息 A',
                position: { x: 0, y: 100 },
                channel: 'sms',
                subject: null,
                body: 'A',
              },
              {
                id: 'n-b',
                type: 'message',
                name: '消息 B',
                position: { x: 0, y: 200 },
                channel: 'sms',
                subject: null,
                body: 'B',
              },
            ],
            edges: [
              { id: 'e1', source: 'n-start', target: 'n-a' },
              { id: 'e2', source: 'n-a', target: 'n-b' },
              { id: 'e3', source: 'n-b', target: 'n-a' },
            ],
          },
        },
        {
          revision: 1,
          draftDefinition: {
            ...draftDefinition,
            nodes: draftDefinition.nodes.map((node) =>
              node.id === 'n-message' ? { ...node, subject: null } : node,
            ),
          },
        },
        { revision: 0, draftDefinition },
        { draftDefinition },
      ];

      for (const payload of invalidPayloads) {
        const response = await putJourneyDraft(app, cookie, id, payload);
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toMatchObject({
          code: 'JOURNEY_DRAFT_INVALID',
          message: '旅程草稿内容无效，请检查节点设置和连线',
        });
      }

      const stored = await db.prisma.journey.findUnique({ where: { id } });
      expect(stored).toMatchObject({ revision: 1, draftDefinition: null });
    } finally {
      await app.close();
    }
  });

  it('只读活动、旅程不存在和无效链接都不能保存草稿', async () => {
    await seedCampaign(campaignAId, '进行中编排活动', 'running');
    const journeyId = '00000000-0000-4000-8202-000000000501';
    await db.prisma.journey.create({
      data: {
        id: journeyId,
        campaignId: campaignAId,
        name: '只读编排旅程',
        createdById: testAccountId,
        updatedById: testAccountId,
      },
    });
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);

      const readonly = await putJourneyDraft(app, cookie, journeyId, {
        revision: 1,
        draftDefinition,
      });
      expect(readonly.statusCode).toBe(409);
      expect(readonly.json().error).toMatchObject({
        code: 'CAMPAIGN_NOT_EDITABLE',
        message: '只有草稿或已暂停的活动可以修改旅程',
      });
      expect(await db.prisma.journey.findUnique({ where: { id: journeyId } })).toMatchObject({
        revision: 1,
        draftDefinition: null,
      });

      const missing = await putJourneyDraft(app, cookie, missingId, {
        revision: 1,
        draftDefinition,
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.message).toBe('旅程不存在');

      const invalidId = await putJourneyDraft(app, cookie, 'not-a-uuid', {
        revision: 1,
        draftDefinition,
      });
      expect(invalidId.statusCode).toBe(400);
      expect(invalidId.json().error.message).toBe('旅程链接无效');
    } finally {
      await app.close();
    }
  });

  it('草稿保存拒绝未登录和跨来源请求，数据库失败不伪装成成功', async () => {
    await seedCampaign(campaignAId, '草稿安全检查活动');
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await createJourney(app, cookie, campaignAId, { name: '草稿安全检查旅程' });
      const id = created.json().data.id as string;

      const unauthenticated = await app.inject({
        method: 'PUT',
        url: `/api/journeys/${id}/draft`,
        headers: {
          host: 'localhost',
          origin: 'http://localhost',
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ revision: 1, draftDefinition }),
      });
      expect(unauthenticated.statusCode).toBe(401);

      const crossOrigin = await putJourneyDraft(
        app,
        cookie,
        id,
        { revision: 1, draftDefinition },
        'https://elsewhere.example',
      );
      expect(crossOrigin.statusCode).toBe(403);

      vi.spyOn(db.prisma, '$transaction').mockRejectedValueOnce(new Error('database write failed'));
      expect(
        (await putJourneyDraft(app, cookie, id, { revision: 1, draftDefinition })).statusCode,
      ).toBe(500);

      expect(await db.prisma.journey.findUnique({ where: { id } })).toMatchObject({
        revision: 1,
        draftDefinition: null,
      });
    } finally {
      await app.close();
    }
  });
});
