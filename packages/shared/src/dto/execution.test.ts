import { describe, expect, it } from 'vitest';
import {
  executionListQuerySchema,
  executionListItemSchema,
  executionTraceSchema,
  executionTraceStepSchema,
} from './execution.js';

const executionId = '3f1c9f1e-2b7a-4d5c-8e9f-0a1b2c3d4e5f';
const journeyId = '8a2d4b6c-1e3f-4a5b-9c7d-2e4f6a8b0c1d';
const campaignId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const audienceId = '33333333-3333-4333-8333-333333333333';
const eventId = '44444444-4444-4444-8444-444444444444';

describe('执行记录查询契约', () => {
  it('默认第 1 页 10 条，并接受筛选和明确时刻', () => {
    expect(executionListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 10 });
    expect(
      executionListQuerySchema.parse({
        campaignId,
        journeyId,
        status: 'waiting',
        q: '  霖铃铃  ',
        createdFrom: '2026-07-30T08:00:00.000Z',
        createdTo: '2026-07-30T09:00:00.000Z',
      }),
    ).toMatchObject({ q: '霖铃铃', status: 'waiting', campaignId, journeyId });
  });

  it('拒绝非法状态、页码、条数和倒置的时间范围', () => {
    expect(executionListQuerySchema.safeParse({ status: 'unknown' }).success).toBe(false);
    expect(executionListQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(executionListQuerySchema.safeParse({ pageSize: 15 }).success).toBe(false);
    expect(executionListQuerySchema.safeParse({ extra: true }).success).toBe(false);
    expect(
      executionListQuerySchema.safeParse({
        createdFrom: '2026-07-30T10:00:00.000Z',
        createdTo: '2026-07-30T09:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      executionListQuerySchema.safeParse({
        endedFrom: '2026-07-30T10:00:00.000Z',
        endedTo: '2026-07-30T09:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(executionListQuerySchema.safeParse({ createdFrom: 'not-a-time' }).success).toBe(false);
  });

  it('列表项区分离运行中的当前步骤和终态结果', () => {
    const listItem = {
      id: executionId,
      audience: { externalId: 'upstream:demo:eligible', displayName: '霖铃铃' },
      campaign: { id: campaignId, name: '演示活动' },
      journey: { id: journeyId, name: '演示旅程' },
      version: { id: versionId, versionNumber: 2 },
      status: 'waiting',
      currentStep: { nodeId: 'wait-purchase', name: '等待同商品购买', nodeType: 'wait_for_event' },
      result: null,
      createdAt: '2026-07-30T08:00:00.000Z',
      startedAt: '2026-07-30T08:00:00.000Z',
      endedAt: null,
    };
    expect(executionListItemSchema.parse(listItem).status).toBe('waiting');
    expect(
      executionListItemSchema.safeParse({
        ...listItem,
        status: 'completed',
        currentStep: null,
        result: '流程结束',
      }).success,
    ).toBe(true);
  });
});

describe('执行轨迹契约', () => {
  const baseStep = {
    order: 2,
    nodeId: 'condition-price',
    nodeName: '商品价格判断',
    nodeType: 'condition',
    status: 'succeeded',
    startedAt: '2026-07-30T08:00:01.000Z',
    endedAt: '2026-07-30T08:00:01.000Z',
    deadlineAt: null,
    matchedEventId: null,
    failureReason: null,
  };

  it('解析条件证据、匹配等待和演示消息输出', () => {
    expect(
      executionTraceStepSchema.parse({
        ...baseStep,
        output: {
          kind: 'condition',
          rule: {
            kind: 'compare',
            left: { source: 'entry_event', eventType: 'product_viewed', path: 'price' },
            operator: 'gte',
            right: 100,
          },
          matched: true,
          branch: 'met',
          evidence: {
            kind: 'value',
            evaluatedAt: '2026-07-30T08:00:01.000Z',
            actual: { exists: true, value: 299 },
          },
        },
      }).output.kind,
    ).toBe('condition');

    expect(
      executionTraceStepSchema.parse({
        ...baseStep,
        order: 4,
        nodeId: 'wait-purchase',
        nodeName: '等待同商品购买',
        nodeType: 'wait_for_event',
        matchedEventId: eventId,
        output: {
          kind: 'wait_for_event',
          eventType: 'purchase_completed',
          waitSeconds: 60,
          sameProduct: true,
          outcome: 'matched',
          matchedEventId: eventId,
        },
      }).matchedEventId,
    ).toBe(eventId);

    expect(
      executionTraceStepSchema.parse({
        ...baseStep,
        order: 5,
        nodeId: 'message-thanks',
        nodeName: '购买感谢消息',
        nodeType: 'message',
        output: {
          kind: 'message',
          channel: 'sms',
          subject: null,
          body: '感谢购买',
          audienceUserId: audienceId,
          demo: true,
        },
      }).output.kind,
    ).toBe('message');
  });

  it('轨迹只接受最小身份、入口证据和触发行为，拒绝完整画像', () => {
    const trace = {
      id: executionId,
      status: 'completed',
      currentNode: { nodeId: 'end-thanks', name: '购买分支结束', nodeType: 'end' },
      failureReason: null,
      createdAt: '2026-07-30T08:00:00.000Z',
      startedAt: '2026-07-30T08:00:00.000Z',
      endedAt: '2026-07-30T08:00:12.000Z',
      campaign: { id: campaignId, name: '演示活动', status: 'running' },
      journey: { id: journeyId, name: '演示旅程' },
      version: { id: versionId, versionNumber: 1, publishedAt: '2026-07-30T07:00:00.000Z' },
      audience: {
        externalId: 'upstream:demo:eligible',
        displayName: '霖铃铃',
      },
      entryEvidence: { segment: null, values: [] },
      triggerEvent: {
        id: eventId,
        type: 'product_viewed',
        receivedAt: '2026-07-30T08:00:00.000Z',
        payload: { productId: 'product-1', price: 299 },
      },
      steps: [
        {
          ...baseStep,
          order: 1,
          nodeId: 'start',
          nodeName: '用户浏览商品',
          nodeType: 'start',
          output: { kind: 'start', entryBehavior: 'product_viewed' },
        },
      ],
    };
    expect(executionTraceSchema.parse(trace).steps).toHaveLength(1);
    expect(
      executionTraceSchema.safeParse({
        ...trace,
        audience: { ...trace.audience, email: 'lin@example.com', attributes: { age: 32 } },
      }).success,
    ).toBe(false);
    expect(
      executionTraceSchema.safeParse({
        ...trace,
        entrySnapshot: { email: 'lin@example.com', attributes: { age: 32 } },
      }).success,
    ).toBe(false);
    const tooManySteps = Array.from({ length: 31 }, (_, index) => ({
      ...trace.steps[0],
      order: index + 1,
      nodeId: `node-${index + 1}`,
    }));
    expect(executionTraceSchema.safeParse({ ...trace, steps: tooManySteps }).success).toBe(false);
  });
});
