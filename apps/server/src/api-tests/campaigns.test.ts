import type { CampaignStatus } from '@journeylens/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountId, now } from '../test-support/fake-prisma.js';
import { jsonHeaders, makeApp, signedInCookie, type TestApp } from '../test-support/harness.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const campaignId = '00000000-0000-4000-8000-000000000001';

const summary = (index: number, status: CampaignStatus = 'draft') => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  name: `活动 ${index}`,
  status,
  updatedAt: now.toISOString(),
});

const rows = Array.from({ length: 23 }, (_, index) => summary(23 - index));
const scheduledRows = Array.from({ length: 5 }, (_, index) => summary(index + 1, 'scheduled'));

function postCampaign(app: TestApp, cookie: string, payload: unknown, origin = 'http://localhost') {
  return app.inject({
    method: 'POST',
    url: '/api/campaigns',
    headers: { ...jsonHeaders(cookie), origin },
    payload: JSON.stringify(payload),
  });
}

describe('活动 API', () => {
  it('创建规范化草稿并从最多 20 条列表读取真实记录', async () => {
    const { app, campaigns, campaignModel } = makeApp();
    try {
      const cookie = await signedInCookie(app);
      const created = await app.inject({
        method: 'POST',
        url: '/api/campaigns',
        headers: jsonHeaders(cookie),
        payload: { name: '  春季活动  ', description: ' 说明 ', budget: { amount: '125.3' } },
      });

      expect(created.statusCode).toBe(201);
      expect(created.json().data).toEqual({
        id: campaignId,
        name: '春季活动',
        description: '说明',
        budget: { amount: '125.30' },
        status: 'draft',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        createdBy: { id: accountId, displayName: '测试运营账号' },
      });
      expect(campaigns[0]?.createdById).toBe(accountId);

      const listed = await app.inject({
        method: 'GET',
        url: '/api/campaigns',
        headers: { cookie },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toEqual({
        data: [
          {
            id: campaignId,
            name: '春季活动',
            status: 'draft',
            updatedAt: now.toISOString(),
          },
        ],
        page: {
          page: 1,
          pageSize: 10,
          total: 1,
        },
      });
      expect(campaignModel.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, name: true, status: true, updatedAt: true },
      });

      const detail = await app.inject({
        method: 'GET',
        url: `/api/campaigns/${campaignId}`,
        headers: { cookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toEqual({ data: created.json().data });
      expect(campaignModel.findUnique).toHaveBeenCalledWith({
        where: { id: campaignId },
        select: {
          id: true,
          name: true,
          description: true,
          budget: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          createdBy: { select: { id: true, displayName: true } },
        },
      });

      const invalidId = await app.inject({
        method: 'GET',
        url: '/api/campaigns/not-a-uuid',
        headers: { cookie },
      });
      expect(invalidId.statusCode).toBe(400);
      const missing = await app.inject({
        method: 'GET',
        url: '/api/campaigns/00000000-0000-4000-8000-000000000099',
        headers: { cookie },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.message).toBe('活动不存在');
    } finally {
      await app.close();
    }
  });

  it('默认第 1 页、翻页与每页条数按约定传给数据库，越界页码回到最后一页', async () => {
    const { app, campaignModel } = makeApp();
    try {
      const cookie = await signedInCookie(app);
      campaignModel.findMany
        .mockResolvedValueOnce(rows.slice(0, 10))
        .mockResolvedValueOnce(rows.slice(10, 20))
        .mockResolvedValueOnce(rows.slice(20))
        .mockResolvedValueOnce(rows)
        .mockResolvedValueOnce(rows.slice(20));
      campaignModel.count
        .mockResolvedValueOnce(23)
        .mockResolvedValueOnce(23)
        .mockResolvedValueOnce(23)
        .mockResolvedValueOnce(23)
        .mockResolvedValueOnce(23);

      const first = await app.inject({
        method: 'GET',
        url: '/api/campaigns',
        headers: { cookie },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({
        data: rows.slice(0, 10),
        page: {
          page: 1,
          pageSize: 10,
          total: 23,
        },
      });
      expect(campaignModel.findMany).toHaveBeenNthCalledWith(1, {
        where: {},
        skip: 0,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, name: true, status: true, updatedAt: true },
      });

      const second = await app.inject({
        method: 'GET',
        url: '/api/campaigns?page=2&pageSize=10',
        headers: { cookie },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({
        data: rows.slice(10, 20),
        page: { page: 2, pageSize: 10, total: 23 },
      });
      expect(campaignModel.findMany).toHaveBeenNthCalledWith(2, {
        where: {},
        skip: 10,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, name: true, status: true, updatedAt: true },
      });

      const twentyPerPage = await app.inject({
        method: 'GET',
        url: '/api/campaigns?page=2&pageSize=20',
        headers: { cookie },
      });
      expect(twentyPerPage.json().page).toEqual({ page: 2, pageSize: 20, total: 23 });
      expect(campaignModel.findMany).toHaveBeenNthCalledWith(3, {
        where: {},
        skip: 20,
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, name: true, status: true, updatedAt: true },
      });

      const fiftyPerPage = await app.inject({
        method: 'GET',
        url: '/api/campaigns?page=1&pageSize=50',
        headers: { cookie },
      });
      expect(fiftyPerPage.json().page).toEqual({ page: 1, pageSize: 50, total: 23 });
      expect(campaignModel.findMany).toHaveBeenNthCalledWith(4, {
        where: {},
        skip: 0,
        take: 50,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, name: true, status: true, updatedAt: true },
      });

      const outOfRange = await app.inject({
        method: 'GET',
        url: '/api/campaigns?page=99&pageSize=10',
        headers: { cookie },
      });
      expect(outOfRange.json().page).toEqual({ page: 3, pageSize: 10, total: 23 });
      expect(outOfRange.json().data).toEqual(rows.slice(20));
      expect(campaignModel.findMany).toHaveBeenNthCalledWith(5, {
        where: {},
        skip: 20,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, name: true, status: true, updatedAt: true },
      });
    } finally {
      await app.close();
    }
  });

  it('按关键字搜索和按状态筛选，未知状态返回 400', async () => {
    const { app, campaignModel } = makeApp();
    try {
      const cookie = await signedInCookie(app);
      campaignModel.findMany.mockResolvedValueOnce([rows[4]]).mockResolvedValueOnce(scheduledRows);
      campaignModel.count.mockResolvedValueOnce(1).mockResolvedValueOnce(5);

      const searched = await app.inject({
        method: 'GET',
        url: '/api/campaigns?q=%E8%AF%B4%E6%98%8E',
        headers: { cookie },
      });
      expect(searched.json().data).toHaveLength(1);
      expect(searched.json().page.total).toBe(1);
      expect(campaignModel.findMany.mock.calls[0]?.[0]).toMatchObject({
        where: {
          OR: [
            { name: { contains: '说明', mode: 'insensitive' } },
            { description: { contains: '说明', mode: 'insensitive' } },
          ],
        },
      });

      const filtered = await app.inject({
        method: 'GET',
        url: '/api/campaigns?status=scheduled',
        headers: { cookie },
      });
      expect(filtered.json().data).toHaveLength(5);
      expect(filtered.json().page.total).toBe(5);
      expect(campaignModel.findMany.mock.calls[1]?.[0]).toMatchObject({
        where: { status: 'scheduled' },
      });

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
    const { app } = makeApp();
    try {
      const cookie = await signedInCookie(app);
      for (const [query, message] of [
        ['?page=0', '页码必须是正整数'],
        ['?page=-1', '页码必须是正整数'],
        ['?page=1.5', '页码必须是正整数'],
        ['?page=abc', '页码必须是正整数'],
        ['?page=1e2', '页码必须是正整数'],
        ['?pageSize=5', '每页条数只能选择 10、20 或 50 条'],
        ['?pageSize=10.0', '每页条数只能选择 10、20 或 50 条'],
        ['?pageSize=abc', '每页条数只能选择 10、20 或 50 条'],
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

  it('未登录访问活动接口返回 401', async () => {
    const { app } = makeApp();
    try {
      expect((await app.inject({ method: 'GET', url: '/api/campaigns' })).statusCode).toBe(401);
      expect(
        (await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}` })).statusCode,
      ).toBe(401);
      const unauthenticatedWrite = await app.inject({
        method: 'POST',
        url: '/api/campaigns',
        headers: {
          host: 'localhost',
          origin: 'http://localhost',
          'content-type': 'application/json',
        },
        payload: { name: '未登录创建' },
      });
      expect(unauthenticatedWrite.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('没有数据时返回第一页空列表', async () => {
    const { app } = makeApp();
    try {
      const cookie = await signedInCookie(app);
      const emptyList = await app.inject({
        method: 'GET',
        url: '/api/campaigns?page=3&pageSize=10',
        headers: { cookie },
      });
      expect(emptyList.json()).toMatchObject({
        data: [],
        page: { page: 1, pageSize: 10, total: 0 },
      });
    } finally {
      await app.close();
    }
  });

  it('创建时拒绝空白名称、超长字段、多余字段和非法预算', async () => {
    const { app, campaigns } = makeApp();
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
      expect(campaigns).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('创建请求来自其他站点时被拒绝', async () => {
    const { app } = makeApp();
    try {
      const cookie = await signedInCookie(app);
      expect(
        (await postCampaign(app, cookie, { name: '有效名称' }, 'https://elsewhere.example'))
          .statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('空说明保存为 null，零与上限预算按两位小数保存', async () => {
    const { app, campaigns } = makeApp();
    try {
      const cookie = await signedInCookie(app);

      expect(
        (await postCampaign(app, cookie, { name: '有效名称', description: '   ' })).json().data
          .description,
      ).toBeNull();
      expect(
        (await postCampaign(app, cookie, { name: 'x'.repeat(180), description: 'y'.repeat(4000) }))
          .statusCode,
      ).toBe(201);
      expect((await postCampaign(app, cookie, { name: '有效名称' })).statusCode).toBe(201);
      expect((await postCampaign(app, cookie, { name: '有效名称' })).statusCode).toBe(201);
      expect(
        (await postCampaign(app, cookie, { name: '零预算', budget: { amount: '0' } })).json().data
          .budget,
      ).toEqual({ amount: '0.00' });
      expect(
        (
          await postCampaign(app, cookie, {
            name: '最高预算',
            budget: { amount: '999999999999.99' },
          })
        ).json().data.budget,
      ).toEqual({ amount: '999999999999.99' });
      expect(
        (await postCampaign(app, cookie, { name: '不设置预算', budget: null })).json().data.budget,
      ).toBeNull();
      expect(campaigns).toHaveLength(7);
    } finally {
      await app.close();
    }
  });

  it('不把读取或写入失败伪装成成功', async () => {
    const { app, campaignModel } = makeApp();
    try {
      const cookie = await signedInCookie(app);
      campaignModel.findMany.mockRejectedValueOnce(new Error('database read failed'));
      const listFailure = await app.inject({
        method: 'GET',
        url: '/api/campaigns',
        headers: { cookie },
      });
      expect(listFailure.statusCode).toBe(500);
      expect(listFailure.json().error.code).toBe('INTERNAL_ERROR');

      campaignModel.findUnique.mockRejectedValueOnce(new Error('database read failed'));
      const detailFailure = await app.inject({
        method: 'GET',
        url: `/api/campaigns/${campaignId}`,
        headers: { cookie },
      });
      expect(detailFailure.statusCode).toBe(500);
      expect(detailFailure.json().error.code).toBe('INTERNAL_ERROR');

      campaignModel.create.mockRejectedValueOnce(new Error('database write failed'));
      const createFailure = await app.inject({
        method: 'POST',
        url: '/api/campaigns',
        headers: jsonHeaders(cookie),
        payload: { name: '活动' },
      });
      expect(createFailure.statusCode).toBe(500);
      expect(createFailure.json().error.code).toBe('INTERNAL_ERROR');
    } finally {
      await app.close();
    }
  });

  it('PATCH 保留未提供字段，并可清空说明和预算', async () => {
    const { app, campaigns, campaignModel } = makeApp();
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
      expect(renamed.json().data.updatedAt).not.toBe(originalCreatedAt);
      expect(campaignModel.updateMany).toHaveBeenCalledWith({
        where: { id },
        data: { name: '修改后的名称' },
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
      expect(campaigns[0]?.description).toBeNull();
      expect(campaigns[0]?.budget).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('PATCH 拒绝空对象、额外字段、非法字段和非法预算', async () => {
    const { app } = makeApp();
    try {
      const cookie = await signedInCookie(app);
      const request = (payload: unknown, id = campaignId) =>
        app.inject({
          method: 'PATCH',
          url: `/api/campaigns/${id}`,
          headers: jsonHeaders(cookie),
          payload: JSON.stringify(payload),
        });

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
            url: `/api/campaigns/${campaignId}`,
            headers: { ...jsonHeaders(cookie), origin: 'https://elsewhere.example' },
            payload: { name: '跨来源修改' },
          })
        ).statusCode,
      ).toBe(403);
      expect((await request({ name: '修改' }, 'not-a-uuid')).statusCode).toBe(400);
      expect(
        (await request({ name: '修改' }, '00000000-0000-4000-8000-000000000099')).statusCode,
      ).toBe(404);

      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/api/campaigns/${campaignId}`,
            headers: {
              host: 'localhost',
              origin: 'http://localhost',
              'content-type': 'application/json',
            },
            payload: { name: '未登录修改' },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('DELETE 只删除草稿，成功返回 204，删除后详情不存在', async () => {
    const { app, campaigns, campaignModel } = makeApp();
    try {
      const cookie = await signedInCookie(app);
      const headers = jsonHeaders(cookie);
      const deleteHeaders = { host: 'localhost', origin: 'http://localhost', cookie };
      const created = await app.inject({
        method: 'POST',
        url: '/api/campaigns',
        headers,
        payload: { name: '待删除活动' },
      });
      const id = created.json().data.id as string;

      const invalidId = await app.inject({
        method: 'DELETE',
        url: '/api/campaigns/not-a-uuid',
        headers,
      });
      expect(invalidId.statusCode).toBe(400);

      const wrongOrigin = await app.inject({
        method: 'DELETE',
        url: `/api/campaigns/${id}`,
        headers: { ...deleteHeaders, origin: 'https://elsewhere.example' },
      });
      expect(wrongOrigin.statusCode).toBe(403);

      const unauthenticated = await app.inject({
        method: 'DELETE',
        url: `/api/campaigns/${id}`,
        headers: { host: 'localhost', origin: 'http://localhost' },
      });
      expect(unauthenticated.statusCode).toBe(401);

      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/campaigns/${id}`,
        headers: deleteHeaders,
      });
      expect(deleted.statusCode).toBe(204);
      expect(deleted.body).toBe('');
      expect(campaignModel.deleteMany).toHaveBeenCalledWith({
        where: { id, status: 'draft' },
      });
      expect(campaigns).toHaveLength(0);

      const detail = await app.inject({
        method: 'GET',
        url: `/api/campaigns/${id}`,
        headers: { cookie },
      });
      expect(detail.statusCode).toBe(404);
      const repeatedDelete = await app.inject({
        method: 'DELETE',
        url: `/api/campaigns/${id}`,
        headers: deleteHeaders,
      });
      expect(repeatedDelete.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('PATCH 或 DELETE 的数据库失败不会返回成功', async () => {
    const { app, campaignModel } = makeApp();
    try {
      const cookie = await signedInCookie(app);
      const headers = jsonHeaders(cookie);
      const created = await app.inject({
        method: 'POST',
        url: '/api/campaigns',
        headers,
        payload: { name: '数据库失败活动' },
      });
      const id = created.json().data.id as string;

      campaignModel.updateMany.mockRejectedValueOnce(new Error('database update failed'));
      const updateFailure = await app.inject({
        method: 'PATCH',
        url: `/api/campaigns/${id}`,
        headers,
        payload: { name: '更新失败' },
      });
      expect(updateFailure.statusCode).toBe(500);
      expect(updateFailure.json().error.code).toBe('INTERNAL_ERROR');

      campaignModel.deleteMany.mockRejectedValueOnce(new Error('database delete failed'));
      const deleteFailure = await app.inject({
        method: 'DELETE',
        url: `/api/campaigns/${id}`,
        headers: { host: 'localhost', origin: 'http://localhost', cookie },
      });
      expect(deleteFailure.statusCode).toBe(500);
      expect(deleteFailure.json().error.code).toBe('INTERNAL_ERROR');
    } finally {
      await app.close();
    }
  });
});
