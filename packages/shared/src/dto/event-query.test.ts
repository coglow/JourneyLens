import { describe, expect, it } from 'vitest';
import {
  eventDetailResponseSchema,
  eventExecutionListQuerySchema,
  eventExecutionListResponseSchema,
  eventListQuerySchema,
  eventListResponseSchema,
} from './event-query.js';

const eventId = '3f1c9f1e-2b7a-4d5c-8e9f-0a1b2c3d4e5f';
const timestamp = '2026-07-30T08:00:00.000Z';

describe('行为查询契约', () => {
  it('使用统一分页默认值并接受受支持的筛选', () => {
    expect(eventListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 10 });
    expect(
      eventListQuerySchema.parse({
        q: ' user ',
        type: 'product_viewed',
        receivedFrom: timestamp,
        receivedTo: timestamp,
        eventId,
        page: '2',
        pageSize: '20',
      }),
    ).toEqual({
      q: 'user',
      type: 'product_viewed',
      receivedFrom: timestamp,
      receivedTo: timestamp,
      eventId,
      page: 2,
      pageSize: 20,
    });
  });

  it('拒绝非法分页、行为类型、ID和逆序时间范围', () => {
    expect(eventListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(eventListQuerySchema.safeParse({ pageSize: '25' }).success).toBe(false);
    expect(eventListQuerySchema.safeParse({ type: 'other' }).success).toBe(false);
    expect(eventListQuerySchema.safeParse({ eventId: 'not-a-uuid' }).success).toBe(false);
    expect(
      eventListQuerySchema.safeParse({
        receivedFrom: '2026-07-31T00:00:00.000Z',
        receivedTo: timestamp,
      }).success,
    ).toBe(false);
    expect(eventListQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
  });

  it('关联旅程列表使用统一分页参数，不再接受关系分类参数', () => {
    expect(eventExecutionListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 10 });
    expect(eventExecutionListQuerySchema.safeParse({ relation: 'matched' }).success).toBe(false);
  });

  it('验证列表、详情和等待步骤关联响应形状', () => {
    const audience = { externalId: 'user-1', displayName: '小林' };
    expect(
      eventListResponseSchema.safeParse({
        data: [
          {
            id: eventId,
            type: 'product_viewed',
            receivedAt: timestamp,
            audience,
          },
        ],
        page: { page: 1, pageSize: 10, total: 1 },
      }).success,
    ).toBe(true);
    expect(
      eventDetailResponseSchema.safeParse({
        data: {
          id: eventId,
          type: 'product_viewed',
          receivedAt: timestamp,
          payload: { price: 0 },
          audience,
        },
      }).success,
    ).toBe(true);
    expect(
      eventExecutionListResponseSchema.safeParse({
        data: [
          {
            id: eventId,
            campaign: { id: eventId, name: '活动' },
            journey: { id: eventId, name: '旅程' },
            version: { id: eventId, versionNumber: 1 },
            status: 'waiting',
            startedAt: timestamp,
            enteredByEvent: false,
            matchedStep: { nodeId: 'wait', nodeName: '等待购买', endedWaitingAt: null },
          },
        ],
        page: { page: 1, pageSize: 10, total: 1 },
      }).success,
    ).toBe(true);
    expect(
      eventExecutionListResponseSchema.safeParse({
        data: [{ id: eventId, matchedStep: null }],
        page: { page: 1, pageSize: 10, total: 1 },
      }).success,
    ).toBe(false);
  });
});
