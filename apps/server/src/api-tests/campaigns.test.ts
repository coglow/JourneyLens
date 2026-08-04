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

function postCampaign(app: TestApp, cookie: string, payload: unknown, origin = 'http://localhost') {
  return app.inject({
    method: 'POST',
    url: '/api/campaigns',
    headers: { ...jsonHeaders(cookie), origin },
    payload: JSON.stringify(payload),
  });
}

function patchCampaign(
  app: TestApp,
  cookie: string,
  id: string,
  payload: unknown,
  origin = 'http://localhost',
) {
  return app.inject({
    method: 'PATCH',
    url: `/api/campaigns/${id}`,
    headers: { ...jsonHeaders(cookie), origin },
    payload: JSON.stringify(payload),
  });
}

function deleteCampaign(app: TestApp, cookie: string, id: string, origin = 'http://localhost') {
  return app.inject({
    method: 'DELETE',
    url: `/api/campaigns/${id}`,
    headers: { host: 'localhost', origin, cookie },
  });
}

async function seedCampaigns(count = 23): Promise<void> {
  await db.prisma.campaign.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: `Campaign ${String(index + 1).padStart(2, '0')}`,
      description: null,
      budget: null,
      status: 'draft' as const,
      createdById: testAccountId,
      createdAt: new Date(testNow.getTime() + index * 1000),
      updatedAt: new Date(testNow.getTime() + index * 1000),
    })),
  });
}

describe('活动 API', () => {
  it('创建规范化草稿并能从列表和详情读取真实记录', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await postCampaign(app, cookie, {
        name: '  春季活动  ',
        description: ' 说明 ',
        budget: { amount: '125.3' },
      });

      expect(created.statusCode).toBe(201);
      const id = created.json().data.id as string;
      expect(created.json().data).toMatchObject({
        name: '春季活动',
        description: '说明',
        budget: { amount: '125.30' },
        status: 'draft',
        createdBy: { id: testAccountId, displayName: '测试运营账号' },
      });

      const stored = await db.prisma.campaign.findUnique({ where: { id } });
      expect(stored?.name).toBe('春季活动');
      expect(stored?.description).toBe('说明');
      expect(stored?.budget?.toFixed(2)).toBe('125.30');

      const listed = await app.inject({
        method: 'GET',
        url: '/api/campaigns',
        headers: { cookie },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toMatchObject({
        data: [
          {
            id,
            name: '春季活动',
            description: '说明',
            budget: { amount: '125.30' },
            status: 'draft',
            createdBy: { id: testAccountId, displayName: '测试运营账号' },
            journeyCount: 0,
          },
        ],
        page: { page: 1, pageSize: 10, total: 1 },
      });

      const detail = await app.inject({
        method: 'GET',
        url: `/api/campaigns/${id}`,
        headers: { cookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toEqual({ data: created.json().data });

      const invalidId = await app.inject({
        method: 'GET',
        url: '/api/campaigns/not-a-uuid',
        headers: { cookie },
      });
      expect(invalidId.statusCode).toBe(400);
      expect(invalidId.json().error.message).toBe('活动链接无效');

      const missing = await app.inject({
        method: 'GET',
        url: `/api/campaigns/${missingId}`,
        headers: { cookie },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.message).toBe('活动不存在');
    } finally {
      await app.close();
    }
  });

  it('默认第 1 页、翻页和每页条数按约定工作，越界页码回到最后一页', async () => {
    await seedCampaigns();
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const expectedNames = (start: number, end: number) =>
        Array.from(
          { length: end - start + 1 },
          (_, index) => `Campaign ${String(end - index).padStart(2, '0')}`,
        );

      const first = await app.inject({
        method: 'GET',
        url: '/api/campaigns',
        headers: { cookie },
      });
      expect(first.json().page).toEqual({ page: 1, pageSize: 10, total: 23 });
      expect(first.json().data.map((item: { name: string }) => item.name)).toEqual(
        expectedNames(14, 23),
      );

      const second = await app.inject({
        method: 'GET',
        url: '/api/campaigns?page=2&pageSize=10',
        headers: { cookie },
      });
      expect(second.json().page).toEqual({ page: 2, pageSize: 10, total: 23 });
      expect(second.json().data.map((item: { name: string }) => item.name)).toEqual(
        expectedNames(4, 13),
      );

      const fifty = await app.inject({
        method: 'GET',
        url: '/api/campaigns?page=1&pageSize=50',
        headers: { cookie },
      });
      expect(fifty.json().page).toEqual({ page: 1, pageSize: 50, total: 23 });
      expect(fifty.json().data).toHaveLength(23);

      const outOfRange = await app.inject({
        method: 'GET',
        url: '/api/campaigns?page=99&pageSize=10',
        headers: { cookie },
      });
      expect(outOfRange.json().page).toEqual({ page: 3, pageSize: 10, total: 23 });
      expect(outOfRange.json().data.map((item: { name: string }) => item.name)).toEqual(
        expectedNames(1, 3),
      );
    } finally {
      await app.close();
    }
  });

  it('按关键字、说明和状态筛选，未知状态返回 400', async () => {
    await db.prisma.campaign.createMany({
      data: [
        {
          id: '00000000-0000-4000-8000-000000000101',
          name: '春季高价值用户',
          description: null,
          status: 'draft',
          createdById: testAccountId,
        },
        {
          id: '00000000-0000-4000-8000-000000000102',
          name: '夏季活动',
          description: '带说明的活动',
          status: 'running',
          createdById: testAccountId,
        },
        {
          id: '00000000-0000-4000-8000-000000000103',
          name: '秋季活动',
          description: null,
          status: 'running',
          createdById: testAccountId,
        },
        {
          id: '00000000-0000-4000-8000-000000000104',
          name: '冬季活动',
          description: null,
          status: 'paused',
          createdById: testAccountId,
        },
      ],
    });
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const keyword = await app.inject({
        method: 'GET',
        url: '/api/campaigns?q=%E6%98%A5%E5%AD%A3',
        headers: { cookie },
      });
      expect(keyword.json().page.total).toBe(1);
      expect(keyword.json().data[0].name).toBe('春季高价值用户');

      const description = await app.inject({
        method: 'GET',
        url: '/api/campaigns?q=%E8%AF%B4%E6%98%8E',
        headers: { cookie },
      });
      expect(description.json().page.total).toBe(1);
      expect(description.json().data[0].name).toBe('夏季活动');

      const filtered = await app.inject({
        method: 'GET',
        url: '/api/campaigns?status=running',
        headers: { cookie },
      });
      expect(filtered.json().page.total).toBe(2);

      // 暂停是新增的可筛选状态，列表和详情使用同一套枚举。
      const pausedOnly = await app.inject({
        method: 'GET',
        url: '/api/campaigns?status=paused',
        headers: { cookie },
      });
      expect(pausedOnly.json().page.total).toBe(1);
      expect(pausedOnly.json().data[0]).toMatchObject({ name: '冬季活动', status: 'paused' });

      const invalidStatus = await app.inject({
        method: 'GET',
        url: '/api/campaigns?status=unknown',
        headers: { cookie },
      });
      expect(invalidStatus.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('拒绝非法页码和每页条数，并说明具体原因', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      for (const [query, message] of [
        ['?page=0', '页码必须是正整数'],
        ['?page=-1', '页码必须是正整数'],
        ['?page=1.5', '页码必须是正整数'],
        ['?page=abc', '页码必须是正整数'],
        ['?pageSize=5', '每页条数只能选择 10、20 或 50 条'],
        ['?pageSize=10.0', '每页条数只能选择 10、20 或 50 条'],
        ['?page=0&pageSize=5', '页码必须是正整数；每页条数只能选择 10、20 或 50 条'],
      ]) {
        const invalid = await app.inject({
          method: 'GET',
          url: `/api/campaigns${query}`,
          headers: { cookie },
        });
        expect(invalid.statusCode).toBe(400);
        expect(invalid.json().error.message).toBe(message);
      }
    } finally {
      await app.close();
    }
  });

  it('没有数据时返回第一页空列表', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const empty = await app.inject({
        method: 'GET',
        url: '/api/campaigns?page=3&pageSize=10',
        headers: { cookie },
      });
      expect(empty.json()).toMatchObject({
        data: [],
        page: { page: 1, pageSize: 10, total: 0 },
      });
    } finally {
      await app.close();
    }
  });

  it('创建时拒绝空白名称、超长字段、多余字段和非法预算', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      for (const payload of [
        { name: '' },
        { name: '   ' },
        { name: 'x'.repeat(181) },
        { name: '有效名称', description: 'x'.repeat(4001) },
        { name: '有效名称', extra: 'not allowed' },
        { name: '有效名称', budget: { amount: '-1' } },
        { name: '有效名称', budget: { amount: '1e3' } },
        { name: '有效名称', budget: { amount: 100 } },
        { name: '有效名称', budget: { amount: '1000000000000' } },
        { name: '有效名称', budget: { amount: '1.001' } },
        { name: '有效名称', budget: { amount: '100', currency: 'USD' } },
      ]) {
        expect((await postCampaign(app, cookie, payload)).statusCode).toBe(400);
      }
      expect(await db.prisma.campaign.count()).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('创建请求来自其他站点或未登录时被拒绝', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      expect(
        (await postCampaign(app, cookie, { name: '有效名称' }, 'https://elsewhere.example'))
          .statusCode,
      ).toBe(403);

      const unauthenticated = await app.inject({
        method: 'POST',
        url: '/api/campaigns',
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

  it('空说明保存为 null，零与上限预算按两位小数保存', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const emptyDescription = await postCampaign(app, cookie, {
        name: '空说明',
        description: '   ',
      });
      expect(emptyDescription.json().data.description).toBeNull();

      const zero = await postCampaign(app, cookie, {
        name: '零预算',
        budget: { amount: '0' },
      });
      expect(zero.json().data.budget).toEqual({ amount: '0.00' });

      const maximum = await postCampaign(app, cookie, {
        name: '最高预算',
        budget: { amount: '999999999999.99' },
      });
      expect(maximum.json().data.budget).toEqual({ amount: '999999999999.99' });

      const none = await postCampaign(app, cookie, { name: '不设置预算', budget: null });
      expect(none.json().data.budget).toBeNull();

      expect(await db.prisma.campaign.count()).toBe(4);
    } finally {
      await app.close();
    }
  });

  it('PATCH 保留未提供字段，并可清空说明和预算', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const headers = jsonHeaders(cookie);
      const created = await app.inject({
        method: 'POST',
        url: '/api/campaigns',
        headers,
        payload: {
          name: '待修改活动',
          description: '保留这段说明',
          budget: { amount: '125.30' },
        },
      });
      const id = created.json().data.id as string;
      const originalCreatedAt = created.json().data.createdAt as string;
      const originalCreator = created.json().data.createdBy;

      const renamed = await app.inject({
        method: 'PATCH',
        url: `/api/campaigns/${id}`,
        headers,
        payload: { name: '  修改后的名称  ' },
      });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json().data).toMatchObject({
        id,
        name: '修改后的名称',
        description: '保留这段说明',
        budget: { amount: '125.30' },
        createdAt: originalCreatedAt,
        createdBy: originalCreator,
      });

      const cleared = await app.inject({
        method: 'PATCH',
        url: `/api/campaigns/${id}`,
        headers,
        payload: { description: null, budget: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json().data).toMatchObject({
        name: '修改后的名称',
        description: null,
        budget: null,
        createdAt: originalCreatedAt,
        createdBy: originalCreator,
      });

      const stored = await db.prisma.campaign.findUnique({ where: { id } });
      expect(stored?.description).toBeNull();
      expect(stored?.budget).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('PATCH 拒绝空对象、额外字段、非法字段和非法预算', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await postCampaign(app, cookie, { name: '合法活动' });
      const id = created.json().data.id as string;
      const request = (payload: unknown, targetId = id) =>
        patchCampaign(app, cookie, targetId, payload);

      for (const payload of [
        {},
        { status: 'draft' },
        { name: '   ' },
        { description: 'x'.repeat(4001) },
        { budget: { amount: '-0.01' } },
        { budget: { amount: '1e3' } },
        { budget: { amount: 12 } },
        { budget: { amount: '1.234' } },
        { budget: { amount: '100', currency: 'USD' } },
      ]) {
        expect((await request(payload)).statusCode).toBe(400);
      }

      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/api/campaigns/${id}`,
            headers: { ...jsonHeaders(cookie), origin: 'https://elsewhere.example' },
            payload: { name: '跨来源修改' },
          })
        ).statusCode,
      ).toBe(403);
      expect((await request({ name: '修改' }, 'not-a-uuid')).statusCode).toBe(400);
      expect((await request({ name: '修改' }, missingId)).statusCode).toBe(404);

      const unauthenticated = await app.inject({
        method: 'PATCH',
        url: `/api/campaigns/${id}`,
        headers: {
          host: 'localhost',
          origin: 'http://localhost',
          'content-type': 'application/json',
        },
        payload: { name: '未登录修改' },
      });
      expect(unauthenticated.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('PATCH 允许草稿和暂停，其他状态返回不可编辑', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await postCampaign(app, cookie, { name: '可维护活动' });
      const id = created.json().data.id as string;

      await db.prisma.campaign.update({ where: { id }, data: { status: 'paused' } });
      const updated = await patchCampaign(app, cookie, id, { description: '暂停期间补充说明' });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().data).toMatchObject({
        status: 'paused',
        description: '暂停期间补充说明',
      });

      for (const status of ['running', 'stopped'] as const) {
        await db.prisma.campaign.update({ where: { id }, data: { status } });
        const rejected = await patchCampaign(app, cookie, id, { name: `${status} 改名` });
        expect(rejected.statusCode).toBe(409);
        expect(rejected.json().error).toMatchObject({
          code: 'CAMPAIGN_NOT_EDITABLE',
          message: '只有草稿或已暂停的活动可以修改',
        });
      }
    } finally {
      await app.close();
    }
  });

  it('DELETE 只删除草稿，成功返回 204，删除后详情不存在', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await postCampaign(app, cookie, { name: '待删除活动' });
      const id = created.json().data.id as string;

      expect((await deleteCampaign(app, cookie, id)).statusCode).toBe(204);
      expect(await db.prisma.campaign.count({ where: { id } })).toBe(0);

      const detail = await app.inject({
        method: 'GET',
        url: `/api/campaigns/${id}`,
        headers: { cookie },
      });
      expect(detail.statusCode).toBe(404);

      const repeated = await deleteCampaign(app, cookie, id);
      expect(repeated.statusCode).toBe(404);

      expect((await deleteCampaign(app, cookie, 'not-a-uuid')).statusCode).toBe(400);
      expect((await deleteCampaign(app, cookie, id, 'https://elsewhere.example')).statusCode).toBe(
        403,
      );

      const unauthenticated = await app.inject({
        method: 'DELETE',
        url: `/api/campaigns/${id}`,
        headers: { host: 'localhost', origin: 'http://localhost' },
      });
      expect(unauthenticated.statusCode).toBe(401);

      const stopped = await postCampaign(app, cookie, { name: '已停止活动' });
      const stoppedId = stopped.json().data.id as string;
      await db.prisma.campaign.update({
        where: { id: stoppedId },
        data: { status: 'stopped' },
      });
      // 活动存在但不是草稿：返回状态不允许，而不是笼统的“不存在”。
      const notDraft = await deleteCampaign(app, cookie, stoppedId);
      expect(notDraft.statusCode).toBe(409);
      expect(notDraft.json().error).toMatchObject({
        code: 'CAMPAIGN_NOT_DRAFT',
        message: '只有草稿活动可以删除',
      });
    } finally {
      await app.close();
    }
  });

  it('存在旅程时拒绝删除草稿活动，删除旅程后可以删除', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const created = await postCampaign(app, cookie, { name: '含旅程活动' });
      const campaignId = created.json().data.id as string;
      const emptyCampaign = await postCampaign(app, cookie, { name: '无旅程活动' });
      const emptyCampaignId = emptyCampaign.json().data.id as string;
      const journey = await db.prisma.journey.create({
        data: {
          campaignId,
          name: '关联旅程',
          createdById: testAccountId,
          updatedById: testAccountId,
        },
      });

      const listed = await app.inject({
        method: 'GET',
        url: '/api/campaigns?pageSize=20',
        headers: { cookie },
      });
      const listItems = listed.json().data as Array<{ id: string; journeyCount: number }>;
      expect(listItems.find((item) => item.id === campaignId)?.journeyCount).toBe(1);
      expect(listItems.find((item) => item.id === emptyCampaignId)?.journeyCount).toBe(0);

      const blocked = await deleteCampaign(app, cookie, campaignId);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error).toMatchObject({
        code: 'CAMPAIGN_HAS_JOURNEYS',
        message: '活动中还有旅程，请先删除旅程',
      });
      expect(await db.prisma.campaign.count({ where: { id: campaignId } })).toBe(1);
      expect(await db.prisma.journey.count({ where: { id: journey.id } })).toBe(1);

      await db.prisma.journey.delete({ where: { id: journey.id } });
      expect((await deleteCampaign(app, cookie, campaignId)).statusCode).toBe(204);
      expect(await db.prisma.campaign.count({ where: { id: campaignId } })).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('未登录访问活动接口返回 401', async () => {
    const { app } = makeApp(db);
    try {
      expect((await app.inject({ method: 'GET', url: '/api/campaigns' })).statusCode).toBe(401);
      expect(
        (await app.inject({ method: 'GET', url: `/api/campaigns/${missingId}` })).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('数据库读取或写入失败不会返回成功', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);

      vi.spyOn(db.prisma.campaign, 'findMany').mockRejectedValueOnce(
        new Error('database read failed'),
      );
      expect(
        (await app.inject({ method: 'GET', url: '/api/campaigns', headers: { cookie } }))
          .statusCode,
      ).toBe(500);

      vi.spyOn(db.prisma.campaign, 'create').mockRejectedValueOnce(
        new Error('database write failed'),
      );
      expect((await postCampaign(app, cookie, { name: '写入失败' })).statusCode).toBe(500);

      vi.spyOn(db.prisma.campaign, 'findUnique').mockRejectedValueOnce(
        new Error('database read failed'),
      );
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/api/campaigns/${missingId}`,
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(500);
    } finally {
      await app.close();
    }
  });
});
