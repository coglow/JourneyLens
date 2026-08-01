import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { ApiError, apiClient } from './api';
import { getEvent, getEventExecutions, getEvents } from './events';

const mock = new MockAdapter(apiClient);
const eventId = '3f1c9f1e-2b7a-4d5c-8e9f-0a1b2c3d4e5f';
const executionId = '22222222-2222-4222-8222-222222222222';
const event = {
  id: eventId,
  type: 'product_viewed',
  receivedAt: '2026-07-30T08:00:00.000Z',
  payload: { productId: 'product-1', price: 0 },
  audience: { externalId: 'user-1', displayName: '小林' },
};

beforeEach(() => mock.reset());
afterEach(() => mock.reset());

describe('行为查询请求', () => {
  it('校验筛选并省略列表默认分页值', async () => {
    mock.onGet('/events').reply(200, {
      data: [],
      page: { page: 1, pageSize: 10, total: 0 },
    });

    await getEvents({ q: ' user ', type: 'product_viewed', eventId });
    await getEvents();

    expect(mock.history.get[0]?.params).toEqual({
      q: 'user',
      type: 'product_viewed',
      eventId,
    });
    expect(mock.history.get[1]?.params).toEqual({});
    const error = await getEvents({ pageSize: '17' }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'BAD_REQUEST',
      message: '每页条数只能选择 10、20 或 50 条',
    });
    expect(mock.history.get).toHaveLength(2);
  });

  it('读取详情并保留真实携带的 0 值', async () => {
    mock.onGet(`/events/${eventId}`).reply(200, { data: event });

    expect(await getEvent(eventId)).toEqual(event);
    expect(mock.history.get[0]?.url).toBe(`/events/${eventId}`);
  });

  it('按统一页码请求相关旅程并拒绝关系分类参数', async () => {
    mock.onGet(`/events/${eventId}/executions`).reply(200, {
      data: [
        {
          id: executionId,
          campaign: { id: executionId, name: '活动' },
          journey: { id: executionId, name: '旅程' },
          version: { id: executionId, versionNumber: 1 },
          status: 'waiting',
          startedAt: '2026-07-30T08:00:00.000Z',
          enteredByEvent: false,
          matchedStep: {
            nodeId: 'wait-event',
            nodeName: '等待购买',
            endedWaitingAt: '2026-07-30T08:00:05.000Z',
          },
        },
      ],
      page: { page: 2, pageSize: 20, total: 21 },
    });

    await getEventExecutions(eventId, { page: '2', pageSize: '20' });
    expect(mock.history.get[0]?.params).toEqual({ page: 2, pageSize: 20 });
    const error = await getEventExecutions(eventId, { relation: 'matched' } as never).catch(
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({
      code: 'BAD_REQUEST',
      message: '请检查查询条件',
    });
    expect(mock.history.get).toHaveLength(1);
  });

  it('错误响应结构不会被当作有效记录', async () => {
    mock.onGet(`/events/${eventId}`).reply(200, { data: { id: eventId } });

    const error = await getEvent(eventId).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
