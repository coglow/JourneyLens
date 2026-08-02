import { describe, expect, it } from 'vitest';
import type { JourneyDraftNode } from '@journeylens/shared';
import { aggregateNodeStats, type VersionStatsStep } from './version-stats.js';

const evaluatedAt = '2026-07-30T08:00:00.000Z';
const matchedEventId = '00000000-0000-4000-8000-000000000010';
const audienceUserId = '00000000-0000-4000-8000-000000000011';

const nodes: Array<Pick<JourneyDraftNode, 'id' | 'name' | 'type'>> = [
  { id: 'start', name: '开始', type: 'start' },
  { id: 'condition', name: '价格判断', type: 'condition' },
  { id: 'wait', name: '定时等待', type: 'wait' },
  { id: 'wait-event', name: '等待购买', type: 'wait_for_event' },
  { id: 'message', name: '购买感谢', type: 'message' },
  { id: 'end', name: '结束', type: 'end' },
];

function conditionOutput(branch: 'met' | 'unmet') {
  return {
    kind: 'condition',
    rule: { kind: 'compare', left: { source: 'user', path: 'age' }, operator: 'gte', right: 18 },
    matched: branch === 'met',
    branch,
    evidence: { kind: 'value', evaluatedAt, actual: { exists: true, value: 20 } },
  };
}

function waitForEventOutput(outcome: 'matched' | 'timeout') {
  return {
    kind: 'wait_for_event',
    eventType: 'purchase_completed',
    waitSeconds: 60,
    sameProduct: true,
    outcome,
    matchedEventId: outcome === 'matched' ? matchedEventId : null,
  };
}

const messageOutput = {
  kind: 'message',
  channel: 'sms' as const,
  subject: null,
  body: '感谢购买',
  audienceUserId,
  demo: true as const,
};

const endOutput = { kind: 'end', note: null };

function succeeded(nodeId: string, output: unknown): VersionStatsStep {
  return { nodeId, status: 'succeeded', output };
}

describe('版本节点统计聚合', () => {
  it('按快照顺序统计进入与各状态，分支只取已完成步骤', () => {
    const steps: VersionStatsStep[] = [
      // 执行一：满足分支、等到行为，走完全程。
      succeeded('start', { kind: 'start', entryBehavior: 'product_viewed' }),
      succeeded('condition', conditionOutput('met')),
      succeeded('wait', { kind: 'wait', waitSeconds: 5 }),
      succeeded('wait-event', waitForEventOutput('matched')),
      succeeded('message', messageOutput),
      succeeded('end', endOutput),
      // 执行二：不满足分支直接结束。
      succeeded('start', { kind: 'start', entryBehavior: 'product_viewed' }),
      succeeded('condition', conditionOutput('unmet')),
      succeeded('end', endOutput),
      // 执行三：停在定时等待上。
      succeeded('start', { kind: 'start', entryBehavior: 'product_viewed' }),
      succeeded('condition', conditionOutput('met')),
      { nodeId: 'wait', status: 'waiting', output: { kind: 'wait', waitSeconds: 5 } },
      // 执行四：等到行为超时。
      succeeded('start', { kind: 'start', entryBehavior: 'product_viewed' }),
      succeeded('condition', conditionOutput('met')),
      succeeded('wait', { kind: 'wait', waitSeconds: 5 }),
      succeeded('wait-event', waitForEventOutput('timeout')),
      succeeded('message', messageOutput),
      succeeded('end', endOutput),
    ];

    const result = aggregateNodeStats(nodes, steps);
    const byId = new Map(result.map((node) => [node.nodeId, node]));

    expect(result.map((node) => node.nodeId)).toEqual(nodes.map((node) => node.id));
    expect(byId.get('start')).toMatchObject({
      entered: 4,
      completed: 4,
      waiting: 0,
      failed: 0,
      stopped: 0,
      conditionBranch: null,
      waitOutcome: null,
    });
    expect(byId.get('condition')).toMatchObject({
      entered: 4,
      completed: 4,
      conditionBranch: { met: 3, unmet: 1 },
      waitOutcome: null,
    });
    expect(byId.get('wait')).toMatchObject({ entered: 3, completed: 2, waiting: 1 });
    expect(byId.get('wait-event')).toMatchObject({
      entered: 2,
      completed: 2,
      conditionBranch: null,
      waitOutcome: { matched: 1, timeout: 1 },
    });
    expect(byId.get('message')).toMatchObject({ entered: 2, completed: 2 });
    expect(byId.get('end')).toMatchObject({ entered: 3, completed: 3 });

    // 每个节点的进入数都等于各状态之和。
    for (const node of result) {
      expect(node.entered).toBe(node.completed + node.waiting + node.failed + node.stopped);
    }
  });

  it('消息节点同时含成功与失败步骤时，进入数含失败、生成次数只取成功', () => {
    const result = aggregateNodeStats(
      [{ id: 'message', name: '提醒消息', type: 'message' }],
      [
        succeeded('message', messageOutput),
        {
          nodeId: 'message',
          status: 'failed',
          output: { kind: 'failed', reason: '消息触达失败' },
        },
      ],
    );

    expect(result[0]).toMatchObject({ entered: 2, completed: 1, failed: 1 });
  });

  it('失败与已停止步骤计入各自状态，失败的判断结果不计入分支', () => {
    const result = aggregateNodeStats(
      [
        { id: 'condition', name: '价格判断', type: 'condition' },
        { id: 'wait-event', name: '等待购买', type: 'wait_for_event' },
      ],
      [
        succeeded('condition', conditionOutput('met')),
        {
          nodeId: 'condition',
          status: 'failed',
          output: { kind: 'failed', reason: '判断用户资料失败' },
        },
        { nodeId: 'wait-event', status: 'stopped', output: waitForEventOutput('timeout') },
      ],
    );

    const byId = new Map(result.map((node) => [node.nodeId, node]));
    expect(byId.get('condition')).toMatchObject({
      entered: 2,
      completed: 1,
      failed: 1,
      conditionBranch: { met: 1, unmet: 0 },
    });
    // 已停止的步骤没有走完分支，不增加超时计数。
    expect(byId.get('wait-event')).toMatchObject({
      entered: 1,
      completed: 0,
      stopped: 1,
      waitOutcome: { matched: 0, timeout: 0 },
    });
  });

  it('输出无法按当前契约解析时只少分支计数，状态计数仍然保留', () => {
    const result = aggregateNodeStats(
      [
        { id: 'condition', name: '价格判断', type: 'condition' },
        { id: 'wait-event', name: '等待购买', type: 'wait_for_event' },
      ],
      [
        { nodeId: 'condition', status: 'succeeded', output: { kind: 'condition' } },
        { nodeId: 'wait-event', status: 'succeeded', output: 'broken' },
      ],
    );

    expect(result[0]).toMatchObject({
      entered: 1,
      completed: 1,
      conditionBranch: { met: 0, unmet: 0 },
    });
    expect(result[1]).toMatchObject({
      entered: 1,
      completed: 1,
      waitOutcome: { matched: 0, timeout: 0 },
    });
  });

  it('没有步骤记录时全部节点输出 0 值行', () => {
    const result = aggregateNodeStats(nodes, []);

    expect(result).toHaveLength(nodes.length);
    for (const node of result) {
      expect(node).toMatchObject({
        entered: 0,
        completed: 0,
        waiting: 0,
        failed: 0,
        stopped: 0,
      });
      expect(node.conditionBranch).toEqual(
        node.nodeType === 'condition' ? { met: 0, unmet: 0 } : null,
      );
      expect(node.waitOutcome).toEqual(
        node.nodeType === 'wait_for_event' ? { matched: 0, timeout: 0 } : null,
      );
    }
  });
});
