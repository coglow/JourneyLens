import { describe, expect, it } from 'vitest';
import {
  journeyDraftDefinitionSchema,
  type JourneyDraftDefinition,
  type JourneySimulationScenario,
} from '@journeylens/shared';
import { simulateJourney } from './simulation.js';

function makeScenario(): JourneySimulationScenario {
  return {
    user: { displayName: '张三', email: null, attributes: { age: 25 } },
    entryEvent: {
      id: 'entry-1',
      type: 'product_viewed',
      offsetSeconds: 0,
      payload: { productId: 'P-100', price: 199 },
    },
    historicalEvents: [
      {
        id: 'history-1',
        type: 'purchase_completed',
        offsetSeconds: -2 * 24 * 60 * 60,
        payload: { productId: 'P-200', amount: 99 },
      },
    ],
    scheduledEvents: [
      {
        id: 'future-1',
        type: 'purchase_completed',
        offsetSeconds: 2 * 60 * 60,
        payload: { productId: 'P-100', amount: 199 },
      },
    ],
  };
}

function makeDefinition(nodes: unknown[], edges: unknown[]): JourneyDraftDefinition {
  return journeyDraftDefinitionSchema.parse({ layoutDirection: 'vertical', nodes, edges });
}

function startNode() {
  return {
    id: 'start',
    type: 'start',
    name: '开始',
    position: { x: 0, y: 0 },
    entryBehavior: 'product_viewed',
  };
}

function endNode(id = 'end') {
  return { id, type: 'end', name: '结束', position: { x: 0, y: 200 }, note: null };
}

describe('旅程模拟纯计算', () => {
  it('比较临时用户资料和进入行为属性，并返回实际值证据', () => {
    const definition = makeDefinition(
      [
        startNode(),
        {
          id: 'condition',
          type: 'condition',
          name: '价格判断',
          position: { x: 0, y: 100 },
          rules: {
            kind: 'compare',
            left: { source: 'entry_event', eventType: 'product_viewed', path: 'price' },
            operator: 'gte',
            right: 100,
          },
        },
        endNode('met'),
        endNode('unmet'),
      ],
      [
        { id: 'to-condition', source: 'start', target: 'condition' },
        { id: 'price-met', source: 'condition', target: 'met', branch: 'met' },
        { id: 'price-unmet', source: 'condition', target: 'unmet', branch: 'unmet' },
      ],
    );
    const scenario = makeScenario();
    const result = simulateJourney({ definition, scenario, segment: null });
    const step = result.steps.find((item) => item.nodeType === 'condition');
    expect(step).toMatchObject({
      matched: true,
      branch: 'met',
      evidence: { kind: 'value', actual: { exists: true, value: 199 } },
    });

    scenario.entryEvent.payload.price = 99;
    const changed = simulateJourney({ definition, scenario, segment: null });
    expect(changed.steps.find((item) => item.nodeType === 'condition')).toMatchObject({
      matched: false,
      branch: 'unmet',
      evidence: { kind: 'value', actual: { exists: true, value: 99 } },
    });
  });

  it('次数按当前时间、滚动窗口、过滤和同商品规则实时计算', () => {
    const definition = makeDefinition(
      [
        startNode(),
        {
          id: 'count',
          type: 'condition',
          name: '近期同商品购买',
          position: { x: 0, y: 100 },
          rules: {
            kind: 'event_count',
            eventType: 'purchase_completed',
            windowSeconds: 7 * 24 * 60 * 60,
            sameProduct: true,
            operator: 'gte',
            right: 1,
          },
        },
        endNode('met'),
        endNode('unmet'),
      ],
      [
        { id: 'to-count', source: 'start', target: 'count' },
        { id: 'count-met', source: 'count', target: 'met', branch: 'met' },
        { id: 'count-unmet', source: 'count', target: 'unmet', branch: 'unmet' },
      ],
    );
    const scenario = makeScenario();
    const result = simulateJourney({ definition, scenario, segment: null });
    const step = result.steps.find((item) => item.nodeType === 'condition');
    expect(step).toMatchObject({ matched: false, evidence: { kind: 'event_count', count: 0 } });
    if (step?.nodeType !== 'condition' || step.evidence.kind !== 'event_count')
      throw new Error('缺少次数依据');
    expect(step.evidence.checks).toEqual([
      { eventId: 'history-1', reason: 'product_mismatch' },
      { eventId: 'entry-1', reason: 'wrong_type' },
      { eventId: 'future-1', reason: 'not_yet' },
    ]);

    scenario.historicalEvents[0]!.payload.productId = 'P-100';
    expect(
      simulateJourney({ definition, scenario, segment: null }).steps.find(
        (item) => item.nodeType === 'condition',
      ),
    ).toMatchObject({ matched: true, evidence: { kind: 'event_count', count: 1 } });
  });

  it('等待会跳过不匹配行为，按最早匹配行为推进实际时钟', () => {
    const definition = makeDefinition(
      [
        startNode(),
        {
          id: 'wait',
          type: 'wait_for_event',
          name: '等待同商品购买',
          position: { x: 0, y: 100 },
          eventType: 'purchase_completed',
          waitSeconds: 24 * 60 * 60,
          sameProduct: true,
        },
        endNode('matched'),
        endNode('timeout'),
      ],
      [
        { id: 'to-wait', source: 'start', target: 'wait' },
        { id: 'wait-matched', source: 'wait', target: 'matched', branch: 'matched' },
        { id: 'wait-timeout', source: 'wait', target: 'timeout', branch: 'timeout' },
      ],
    );
    const scenario = makeScenario();
    scenario.scheduledEvents.unshift({
      id: 'wrong-product',
      type: 'purchase_completed',
      offsetSeconds: 60 * 60,
      payload: { productId: 'P-200', amount: 50 },
    });
    const result = simulateJourney({ definition, scenario, segment: null });
    const wait = result.steps.find((step) => step.nodeType === 'wait_for_event');
    expect(wait).toMatchObject({
      outcome: 'matched',
      branch: 'matched',
      startedAtSeconds: 0,
      resolvedAtSeconds: 7_200,
      matchedEventId: 'future-1',
    });
    expect(result.elapsedSeconds).toBe(7_200);
    if (wait?.nodeType !== 'wait_for_event') throw new Error('缺少行为等待步骤');
    expect(wait.checks).toContainEqual({ eventId: 'wrong-product', reason: 'product_mismatch' });
    expect(wait.checks).toContainEqual({ eventId: 'future-1', reason: 'matched' });
  });

  it('等待截止时刻不包含事件，超时是正常分支且证据说明原因', () => {
    const definition = makeDefinition(
      [
        startNode(),
        {
          id: 'wait',
          type: 'wait_for_event',
          name: '等待购买',
          position: { x: 0, y: 100 },
          eventType: 'purchase_completed',
          waitSeconds: 3_600,
          sameProduct: false,
        },
        endNode('matched'),
        endNode('timeout'),
      ],
      [
        { id: 'to-wait', source: 'start', target: 'wait' },
        { id: 'wait-matched', source: 'wait', target: 'matched', branch: 'matched' },
        { id: 'wait-timeout', source: 'wait', target: 'timeout', branch: 'timeout' },
      ],
    );
    const scenario = makeScenario();
    scenario.scheduledEvents[0]!.offsetSeconds = 3_600;
    const result = simulateJourney({ definition, scenario, segment: null });
    expect(result).toMatchObject({ outcome: 'completed', elapsedSeconds: 3_600 });
    expect(result.steps.find((step) => step.nodeType === 'wait_for_event')).toMatchObject({
      outcome: 'timeout',
      branch: 'timeout',
      matchedEventId: null,
      resolvedAtSeconds: 3_600,
      checks: [{ eventId: 'future-1', reason: 'outside_window' }],
    });
  });

  it('同一行为不能唤醒连续两个等待，且计算不修改输入', () => {
    const definition = makeDefinition(
      [
        startNode(),
        {
          id: 'wait-1',
          type: 'wait_for_event',
          name: '第一次等待',
          position: { x: 0, y: 100 },
          eventType: 'purchase_completed',
          waitSeconds: 24 * 60 * 60,
          sameProduct: true,
        },
        {
          id: 'wait-2',
          type: 'wait_for_event',
          name: '第二次等待',
          position: { x: 200, y: 200 },
          eventType: 'purchase_completed',
          waitSeconds: 3_600,
          sameProduct: true,
        },
        endNode('matched'),
        endNode('timeout'),
      ],
      [
        { id: 'to-first', source: 'start', target: 'wait-1' },
        { id: 'first-matched', source: 'wait-1', target: 'wait-2', branch: 'matched' },
        { id: 'first-timeout', source: 'wait-1', target: 'wait-2', branch: 'timeout' },
        { id: 'second-matched', source: 'wait-2', target: 'matched', branch: 'matched' },
        { id: 'second-timeout', source: 'wait-2', target: 'timeout', branch: 'timeout' },
      ],
    );
    const scenario = makeScenario();
    const before = structuredClone(scenario);
    const result = simulateJourney({ definition, scenario, segment: null });
    expect(scenario).toEqual(before);
    expect(result.steps.filter((step) => step.nodeType === 'wait_for_event')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: 'wait-1', matchedEventId: 'future-1' }),
        expect.objectContaining({
          nodeId: 'wait-2',
          outcome: 'timeout',
          checks: [expect.objectContaining({ eventId: 'future-1', reason: 'already_used' })],
        }),
      ]),
    );
  });

  it('进入行为不同于开始设置时返回未进入而不是服务错误', () => {
    const definition = makeDefinition(
      [startNode(), endNode()],
      [{ id: 'to-end', source: 'start', target: 'end' }],
    );
    const scenario = makeScenario();
    scenario.entryEvent.type = 'purchase_completed';
    const result = simulateJourney({ definition, scenario, segment: null });
    expect(result).toMatchObject({ outcome: 'not_entered', steps: [], elapsedSeconds: 0 });
  });
});
