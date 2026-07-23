import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import type { SegmentRule } from '@journeylens/shared';
import { ApiError, apiClient } from './api';
import {
  createSegment,
  deleteSegment,
  getSegment,
  getSegmentUsages,
  getSegments,
  previewSegmentRules,
  refreshSegmentEstimate,
  updateSegment,
} from './segments';

const mock = new MockAdapter(apiClient);
const segmentId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb60';
const account = {
  id: 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120',
  displayName: 'JourneyLens 管理员',
};
const rule: SegmentRule = {
  kind: 'all',
  children: [
    { kind: 'compare', left: { source: 'user', path: 'age' }, operator: 'gte', right: 30 },
  ],
};
const detail = {
  id: segmentId,
  name: '高价值会员',
  description: null,
  rules: rule,
  revision: 1,
  createdAt: '2026-07-19T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
  createdBy: account,
  updatedBy: account,
  audienceEstimate: null,
  journeyCount: 0,
};

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('请求本应失败');
    },
    (error: unknown) => error,
  );
}

beforeEach(() => mock.reset());
afterEach(() => mock.reset());

describe('分群请求', () => {
  it('按分页规则验证参数，并省略默认值', async () => {
    mock.onGet('/segments').reply(200, {
      data: [],
      page: { page: 1, pageSize: 10, total: 0 },
    });
    await getSegments({ q: ' VIP ', page: '2', pageSize: '20' });
    await getSegments();

    expect(mock.history.get[0]?.params).toEqual({ q: 'VIP', page: 2, pageSize: 20 });
    expect(mock.history.get[1]?.params).toEqual({});
    const error = await captureError(getSegments({ pageSize: '17' }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'BAD_REQUEST',
      message: '每页条数只能选择 10、20 或 50 条',
    });
    expect(mock.history.get).toHaveLength(2);
  });

  it('创建、读取、修改和删除都使用分群现有接口', async () => {
    mock.onPost('/segments').reply(201, { data: detail });
    mock.onGet(`/segments/${segmentId}`).reply(200, { data: detail });
    mock.onPatch(`/segments/${segmentId}`).reply(200, { data: detail });
    mock.onDelete(`/segments/${segmentId}`).reply(204);

    await createSegment({ name: ' 高价值会员 ', rules: rule });
    await getSegment(segmentId);
    await updateSegment(segmentId, { revision: 1, name: '高价值会员', rules: rule });
    await deleteSegment(segmentId);

    expect(JSON.parse(String(mock.history.post[0]?.data))).toEqual({
      name: '高价值会员',
      description: null,
      rules: rule,
    });
    expect(JSON.parse(String(mock.history.patch[0]?.data))).toEqual({
      revision: 1,
      name: '高价值会员',
      rules: rule,
    });
    expect(mock.history.get[0]?.url).toBe(`/segments/${segmentId}`);
    expect(mock.history.delete[0]?.url).toBe(`/segments/${segmentId}`);
  });

  it('读取旅程引用时验证页码参数并使用分群引用地址', async () => {
    mock.onGet(`/segments/${segmentId}/usages`).reply(200, {
      data: [
        {
          journey: { id: '88a0f727-a226-4cb4-9495-74364f8d0e33', name: '欢迎旅程' },
          campaign: {
            id: '2d4f4d57-9d59-4ed5-a2fa-d71733cebb60',
            name: '春季活动',
            status: 'draft',
          },
          updatedAt: '2026-07-19T00:00:00.000Z',
        },
      ],
      page: { page: 2, pageSize: 20, total: 21 },
    });

    await getSegmentUsages(segmentId, { page: '2', pageSize: '20' });
    expect(mock.history.get[0]?.url).toBe(`/segments/${segmentId}/usages`);
    expect(mock.history.get[0]?.params).toEqual({ page: 2, pageSize: 20 });

    const error = await getSegmentUsages(segmentId, { pageSize: '17' }).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'BAD_REQUEST',
      message: '每页条数只能选择 10、20 或 50 条',
    });
    expect(mock.history.get).toHaveLength(1);
  });

  it('把未保存规则试算与已保存分群人数刷新分成两种输入', async () => {
    mock.onPost('/segments/preview').replyOnce(200, {
      data: { total: 20, matched: 8, calculatedAt: '2026-07-19T00:00:00.000Z' },
    });
    mock.onPost('/segments/preview').replyOnce(200, {
      data: { total: 20, matched: 8, calculatedAt: '2026-07-19T00:01:00.000Z', revision: 1 },
    });

    const preview = await previewSegmentRules(rule);
    const refreshed = await refreshSegmentEstimate(segmentId, 1);

    expect(preview.matched).toBe(8);
    expect(refreshed.revision).toBe(1);
    expect(JSON.parse(String(mock.history.post[0]?.data))).toEqual({ rules: rule });
    expect(JSON.parse(String(mock.history.post[1]?.data))).toEqual({ segmentId, revision: 1 });
  });
});
