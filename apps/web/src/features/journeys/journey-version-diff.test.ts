import { describe, expect, it } from 'vitest';
import type {
  JourneyDraftEdge,
  JourneyDraftNode,
  JourneyLayoutDirection,
  JourneyVersionSnapshot,
  SegmentRule,
} from '@journeylens/shared';
import {
  diffJourneyVersions,
  type JourneyVersionDiffGroup,
  type JourneyVersionDiffItem,
} from './journey-version-diff';

type StartNode = Extract<JourneyDraftNode, { type: 'start' }>;
type MessageNode = Extract<JourneyDraftNode, { type: 'message' }>;
type EndNode = Extract<JourneyDraftNode, { type: 'end' }>;
type WaitNode = Extract<JourneyDraftNode, { type: 'wait' }>;
type ConditionNode = Extract<JourneyDraftNode, { type: 'condition' }>;
type WaitForEventNode = Extract<JourneyDraftNode, { type: 'wait_for_event' }>;
type SegmentSnapshot = NonNullable<JourneyVersionSnapshot['entrySegment']>;

const startNode: StartNode = {
  id: 'start',
  type: 'start',
  name: '进入',
  position: { x: 0, y: 0 },
  entryBehavior: 'registration_completed',
};

const messageNode: MessageNode = {
  id: 'message',
  type: 'message',
  name: '欢迎短信',
  position: { x: 0, y: 100 },
  channel: 'sms',
  subject: null,
  body: '欢迎加入',
};

const endNode: EndNode = {
  id: 'end',
  type: 'end',
  name: '结束',
  position: { x: 0, y: 200 },
  note: null,
};

const baseEdges: JourneyDraftEdge[] = [
  { id: 'edge-1', source: 'start', target: 'message' },
  { id: 'edge-2', source: 'message', target: 'end' },
];

function makeSnapshot(options: {
  name?: string;
  description?: string | null;
  entrySegment?: SegmentSnapshot | null;
  nodes: JourneyDraftNode[];
  edges?: JourneyDraftEdge[];
  layoutDirection?: JourneyLayoutDirection;
}): JourneyVersionSnapshot {
  return {
    name: options.name ?? '新客旅程',
    description: options.description ?? null,
    entrySegment: options.entrySegment ?? null,
    definition: {
      layoutDirection: options.layoutDirection ?? 'vertical',
      nodes: options.nodes,
      edges: options.edges ?? [],
    },
  };
}

function baseSnapshot(overrides: Partial<Parameters<typeof makeSnapshot>[0]> = {}) {
  return makeSnapshot({
    nodes: [startNode, messageNode, endNode],
    edges: baseEdges,
    ...overrides,
  });
}

const segmentRules: SegmentRule = {
  kind: 'all',
  children: [
    { kind: 'compare', left: { source: 'user', path: 'vipLevel' }, operator: 'eq', right: 'gold' },
  ],
};

function makeSegment(overrides: Partial<SegmentSnapshot> = {}): SegmentSnapshot {
  return { id: 'segment-1', name: '高价值客户', revision: 1, rules: segmentRules, ...overrides };
}

type DiffItemByGroup = {
  [G in JourneyVersionDiffGroup]: Extract<JourneyVersionDiffItem, { group: G }>;
};

function groups<G extends JourneyVersionDiffGroup>(
  items: JourneyVersionDiffItem[],
  group: G,
): DiffItemByGroup[G][] {
  return items.filter((item) => item.group === group) as DiffItemByGroup[G][];
}

function updatedItems(items: JourneyVersionDiffItem[]) {
  return groups(items, 'node-updated');
}

describe('旅程版本内容对比', () => {
  it('只改节点坐标、布局方向和连线标识时没有任何变更', () => {
    const after = makeSnapshot({
      nodes: [startNode, { ...messageNode, position: { x: 320, y: 180 } }, endNode],
      edges: [
        { id: 'edge-a', source: 'start', target: 'message' },
        { id: 'edge-b', source: 'message', target: 'end' },
      ],
      layoutDirection: 'horizontal',
    });

    expect(diffJourneyVersions(baseSnapshot(), after)).toEqual([]);
  });

  it('连线起止和分支不变时，只换连线标识不算改动', () => {
    const after = makeSnapshot({
      nodes: [startNode, messageNode, endNode],
      edges: [
        { id: 'edge-other-1', source: 'start', target: 'message' },
        { id: 'edge-other-2', source: 'message', target: 'end' },
      ],
    });

    expect(diffJourneyVersions(baseSnapshot(), after)).toEqual([]);
  });

  it('消息正文变化归为修改步骤，并标出具体字段', () => {
    const after = makeSnapshot({
      nodes: [startNode, { ...messageNode, body: '欢迎回来' }, endNode],
      edges: baseEdges,
    });

    const items = diffJourneyVersions(baseSnapshot(), after);
    const [update] = updatedItems(items);
    expect(update).toBeDefined();
    expect(update?.title).toBe('「欢迎短信」');
    expect(update?.textOnly).toBe(false);
    expect(update?.details.find((row) => row.label === '消息内容')).toEqual({
      label: '消息内容',
      before: '欢迎加入',
      after: '欢迎回来',
      marked: true,
    });
  });

  it('只改步骤名称时单独给出名称前后值', () => {
    const after = makeSnapshot({
      nodes: [startNode, { ...messageNode, name: '欢迎邮件' }, endNode],
      edges: baseEdges,
    });

    const [update] = updatedItems(diffJourneyVersions(baseSnapshot(), after));
    expect(update?.title).toBe('「欢迎短信」→「欢迎邮件」');
    expect(update?.details[0]).toEqual({
      label: '步骤名称',
      before: '欢迎短信',
      after: '欢迎邮件',
      marked: true,
    });
  });

  it('结束说明从空值改成文字未填写时仍算变更，并提示文字表述相同', () => {
    const after = makeSnapshot({
      nodes: [startNode, messageNode, { ...endNode, note: '未填写' }],
      edges: baseEdges,
    });

    const items = diffJourneyVersions(baseSnapshot(), after);
    const [update] = updatedItems(items);
    expect(update).toBeDefined();
    expect(update?.textOnly).toBe(true);
    expect(update?.details.every((row) => row.marked === false)).toBe(true);
  });

  it('开始行为的进入方式变化算修改步骤', () => {
    const after = makeSnapshot({
      nodes: [{ ...startNode, entryBehavior: 'purchase_completed' }, messageNode, endNode],
      edges: baseEdges,
    });

    const [update] = updatedItems(diffJourneyVersions(baseSnapshot(), after));
    expect(update?.details.find((row) => row.label === '进入行为')).toEqual({
      label: '进入行为',
      before: '完成注册',
      after: '完成购买',
      marked: true,
    });
  });

  it('等待时长和行为等待的筛选条件变化都算修改步骤', () => {
    const waitNode: WaitNode = {
      id: 'wait',
      type: 'wait',
      name: '等一天',
      position: { x: 0, y: 100 },
      waitSeconds: 86_400,
    };
    const waitForEventNode: WaitForEventNode = {
      id: 'wait-event',
      type: 'wait_for_event',
      name: '等下单',
      position: { x: 0, y: 200 },
      eventType: 'purchase_completed',
      waitSeconds: 3_600,
      filter: { path: 'amount', operator: 'gt', right: 100 },
      sameProduct: true,
    };
    const edges: JourneyDraftEdge[] = [
      { id: 'e1', source: 'start', target: 'wait' },
      { id: 'e2', source: 'wait', target: 'wait-event' },
      { id: 'e3', source: 'wait-event', target: 'end', branch: 'matched' },
      { id: 'e4', source: 'wait-event', target: 'end', branch: 'timeout' },
    ];
    const before = makeSnapshot({
      nodes: [startNode, waitNode, waitForEventNode, endNode],
      edges,
    });
    const after = makeSnapshot({
      nodes: [
        startNode,
        { ...waitNode, waitSeconds: 172_800 },
        { ...waitForEventNode, sameProduct: false },
        endNode,
      ],
      edges,
    });

    const updates = updatedItems(diffJourneyVersions(before, after));
    expect(updates).toHaveLength(2);
    expect(updates[0]?.details.find((row) => row.label === '等待时长')?.marked).toBe(true);
    expect(updates[1]?.details.find((row) => row.label === '商品范围')?.marked).toBe(true);
  });

  it('邮件主题从无到有算修改步骤', () => {
    const before = makeSnapshot({
      nodes: [startNode, messageNode, endNode],
      edges: baseEdges,
    });
    const after = makeSnapshot({
      nodes: [startNode, { ...messageNode, channel: 'email', subject: '本月新品' }, endNode],
      edges: baseEdges,
    });

    const [update] = updatedItems(diffJourneyVersions(before, after));
    expect(update?.details.find((row) => row.label === '邮件主题')).toEqual({
      label: '邮件主题',
      before: '',
      after: '本月新品',
      marked: true,
    });
    expect(update?.details.find((row) => row.label === '消息渠道')?.marked).toBe(true);
  });

  it('条件规则变化算修改步骤', () => {
    const conditionNode: ConditionNode = {
      id: 'condition',
      type: 'condition',
      name: '是否会员',
      position: { x: 0, y: 100 },
      rules: {
        kind: 'compare',
        left: { source: 'user', path: 'vipLevel' },
        operator: 'eq',
        right: 'gold',
      },
    };
    const edges: JourneyDraftEdge[] = [
      { id: 'e1', source: 'start', target: 'condition' },
      { id: 'e2', source: 'condition', target: 'end', branch: 'met' },
      { id: 'e3', source: 'condition', target: 'end', branch: 'unmet' },
    ];
    const before = makeSnapshot({ nodes: [startNode, conditionNode, endNode], edges });
    const after = makeSnapshot({
      nodes: [
        startNode,
        {
          ...conditionNode,
          rules: {
            kind: 'compare',
            left: { source: 'user', path: 'vipLevel' },
            operator: 'eq',
            right: 'platinum',
          },
        },
        endNode,
      ],
      edges,
    });

    const [update] = updatedItems(diffJourneyVersions(before, after));
    expect(update?.details.find((row) => row.label === '条件')?.marked).toBe(true);
  });

  it('新增与移除步骤分别归类，删除后重建同名步骤不会当成改名', () => {
    const waitNode: WaitNode = {
      id: 'wait',
      type: 'wait',
      name: '等待一小时',
      position: { x: 0, y: 100 },
      waitSeconds: 3_600,
    };
    const after = makeSnapshot({
      nodes: [startNode, messageNode, waitNode, endNode],
      edges: [...baseEdges, { id: 'edge-3', source: 'message', target: 'wait' }],
    });

    const added = diffJourneyVersions(baseSnapshot(), after);
    expect(groups(added, 'node-added')).toHaveLength(1);
    expect(groups(added, 'node-added')[0]?.title).toBe('「等待一小时」');
    expect(groups(added, 'node-removed')).toHaveLength(0);

    const removed = diffJourneyVersions(after, baseSnapshot());
    expect(groups(removed, 'node-removed')).toHaveLength(1);

    const rebuilt = makeSnapshot({
      nodes: [startNode, { ...messageNode, id: 'message-copy' }, endNode],
      edges: [
        { id: 'edge-1', source: 'start', target: 'message-copy' },
        { id: 'edge-2', source: 'message-copy', target: 'end' },
      ],
    });
    const items = diffJourneyVersions(baseSnapshot(), rebuilt);
    expect(groups(items, 'node-added')).toHaveLength(1);
    expect(groups(items, 'node-removed')).toHaveLength(1);
    expect(updatedItems(items)).toHaveLength(0);
  });

  it('连线改目标时输出一删一增，而不是一条改动', () => {
    const after = makeSnapshot({
      nodes: [startNode, messageNode, endNode],
      edges: [
        { id: 'edge-1', source: 'start', target: 'end' },
        { id: 'edge-2', source: 'message', target: 'end' },
      ],
    });

    const items = diffJourneyVersions(baseSnapshot(), after);
    const edges = groups(items, 'edge');
    expect(edges).toHaveLength(2);
    expect(edges.filter((item) => item.added)).toHaveLength(1);
    expect(edges.filter((item) => !item.added)).toHaveLength(1);
  });

  it('连线分支变化同样输出一删一增', () => {
    const conditionNode: ConditionNode = {
      id: 'condition',
      type: 'condition',
      name: '是否会员',
      position: { x: 0, y: 100 },
      rules: {
        kind: 'compare',
        left: { source: 'user', path: 'vipLevel' },
        operator: 'eq',
        right: 'gold',
      },
    };
    const edges: JourneyDraftEdge[] = [
      { id: 'e1', source: 'start', target: 'condition' },
      { id: 'e2', source: 'condition', target: 'end', branch: 'met' },
      { id: 'e3', source: 'condition', target: 'end', branch: 'unmet' },
    ];
    const before = makeSnapshot({ nodes: [startNode, conditionNode, endNode], edges });
    const after = makeSnapshot({
      nodes: [startNode, conditionNode, endNode],
      edges: [
        { id: 'e1', source: 'start', target: 'condition' },
        { id: 'e2', source: 'condition', target: 'end', branch: 'met' },
      ],
    });

    expect(groups(diffJourneyVersions(before, after), 'edge')).toHaveLength(1);
  });

  it('旅程名称与说明变化单独归组', () => {
    const after = baseSnapshot({ name: '老客旅程', description: '新说明' });

    const items = diffJourneyVersions(baseSnapshot(), after);
    expect(groups(items, 'meta').map((item) => item.title)).toEqual(['旅程名称', '旅程说明']);
  });

  it('入口人群从不限人群改为指定分群、再改回不限人群都能识别', () => {
    const segment = makeSegment();
    const withSegment = baseSnapshot({ entrySegment: segment });

    const added = groups(diffJourneyVersions(baseSnapshot(), withSegment), 'segment');
    expect(added).toHaveLength(1);
    expect(added[0]?.title).toBe('从不限人群改为「高价值客户」');

    const removed = groups(diffJourneyVersions(withSegment, baseSnapshot()), 'segment');
    expect(removed[0]?.title).toBe('从「高价值客户」改为不限人群');
  });

  it('换绑到另一个分群时说明规则是否相同', () => {
    const before = baseSnapshot({ entrySegment: makeSegment() });
    const sameRules = baseSnapshot({
      entrySegment: makeSegment({ id: 'segment-2', name: '活跃客户' }),
    });
    const otherRules = baseSnapshot({
      entrySegment: makeSegment({
        id: 'segment-2',
        name: '活跃客户',
        rules: { kind: 'any', children: [] },
      }),
    });

    const same = groups(diffJourneyVersions(before, sameRules), 'segment')[0];
    expect(same?.title).toBe('入口人群从「高价值客户」改为「活跃客户」，分群规则相同');

    const other = groups(diffJourneyVersions(before, otherRules), 'segment')[0];
    expect(other?.title).toBe('入口人群从「高价值客户」改为「活跃客户」，分群规则已调整');
    expect(other?.showRules).toBe(true);
  });

  it('同一分群的规则变化会报告，仅改名不报告', () => {
    const before = baseSnapshot({ entrySegment: makeSegment() });
    const renamed = baseSnapshot({
      entrySegment: makeSegment({ name: '高价值客户（新名称）', revision: 2 }),
    });
    const changedRules = baseSnapshot({
      entrySegment: makeSegment({
        revision: 2,
        rules: { kind: 'any', children: [] },
      }),
    });

    expect(groups(diffJourneyVersions(before, renamed), 'segment')).toHaveLength(0);

    const [item] = groups(diffJourneyVersions(before, changedRules), 'segment');
    expect(item?.title).toBe('入口人群规则已调整');
  });

  it('分群规则结构相同但键顺序不同时不报告变更', () => {
    const before = baseSnapshot({ entrySegment: makeSegment() });
    const reordered = baseSnapshot({
      entrySegment: makeSegment({
        revision: 2,
        rules: {
          children: [
            {
              operator: 'eq',
              right: 'gold',
              kind: 'compare',
              left: { path: 'vipLevel', source: 'user' },
            },
          ],
          kind: 'all',
        } as SegmentRule,
      }),
    });

    expect(groups(diffJourneyVersions(before, reordered), 'segment')).toHaveLength(0);
  });

  it('节点标识含连字符时，不同连线不会被当成同一条', () => {
    const nodeA: EndNode = {
      id: 'a',
      type: 'end',
      name: 'A',
      position: { x: 0, y: 0 },
      note: null,
    };
    const nodeBC: EndNode = {
      id: 'b-c',
      type: 'end',
      name: 'BC',
      position: { x: 0, y: 0 },
      note: null,
    };
    const nodeAB: EndNode = {
      id: 'a-b',
      type: 'end',
      name: 'AB',
      position: { x: 0, y: 0 },
      note: null,
    };
    const nodeC: EndNode = {
      id: 'c',
      type: 'end',
      name: 'C',
      position: { x: 0, y: 0 },
      note: null,
    };

    const before = makeSnapshot({
      nodes: [nodeA, nodeBC],
      edges: [{ id: 'e1', source: 'a', target: 'b-c' }],
    });
    const after = makeSnapshot({
      nodes: [nodeAB, nodeC],
      edges: [{ id: 'e2', source: 'a-b', target: 'c' }],
    });

    const edges = groups(diffJourneyVersions(before, after), 'edge');
    expect(edges.filter((item) => item.added)).toHaveLength(1);
    expect(edges.filter((item) => !item.added)).toHaveLength(1);
  });

  it('步骤改名后，被移除的旧连接仍用改名前的叫法', () => {
    const before = makeSnapshot({
      nodes: [startNode, messageNode],
      edges: [{ id: 'e1', source: 'start', target: 'message' }],
    });
    const after = makeSnapshot({
      nodes: [startNode, { ...messageNode, name: '新通知' }],
      edges: [],
    });

    const removed = groups(diffJourneyVersions(before, after), 'edge').find((item) => !item.added);
    expect(removed?.title).toBe('进入 → 欢迎短信');
  });
});
