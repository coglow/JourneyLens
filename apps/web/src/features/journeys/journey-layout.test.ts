import { describe, expect, it } from 'vitest';
import type { JourneyDraftEdge, JourneyDraftNode } from '@journeylens/shared';
import { NODE_HEIGHT, NODE_WIDTH } from './journey-canvas';
import { layoutJourneyNodes } from './journey-layout';

const nodes: JourneyDraftNode[] = [
  {
    id: 'start',
    type: 'start',
    name: '开始',
    position: { x: 0, y: 0 },
    entryBehavior: 'product_viewed',
  },
  {
    id: 'condition',
    type: 'condition',
    name: '条件',
    position: { x: 0, y: 0 },
    rules: {
      kind: 'compare',
      left: { source: 'user', path: 'vipLevel' },
      operator: 'in',
      right: ['gold'],
    },
  },
  {
    id: 'met',
    type: 'wait',
    name: '满足',
    position: { x: 0, y: 0 },
    waitSeconds: 60,
  },
  {
    id: 'unmet',
    type: 'message',
    name: '不满足',
    position: { x: 0, y: 0 },
    channel: 'sms',
    subject: null,
    body: '内容',
  },
  { id: 'end', type: 'end', name: '结束', position: { x: 0, y: 0 }, note: null },
];

const edges: JourneyDraftEdge[] = [
  { id: 'start-condition', source: 'start', target: 'condition' },
  { id: 'condition-met', source: 'condition', target: 'met', branch: 'met' },
  { id: 'condition-unmet', source: 'condition', target: 'unmet', branch: 'unmet' },
  { id: 'met-end', source: 'met', target: 'end' },
  { id: 'unmet-end', source: 'unmet', target: 'end' },
];

describe('旅程画布自动排列', () => {
  it('纵向布局将满足路径放左侧、不满足路径放右侧', () => {
    const positions = layoutJourneyNodes(nodes, edges, 'vertical');

    expect(positions.met!.x).toBeLessThan(positions.condition!.x);
    expect(positions.unmet!.x).toBeGreaterThan(positions.condition!.x);
    expect(positions.end!.y).toBeGreaterThan(positions.condition!.y);
  });

  it('横向布局将满足路径放上方、不满足路径放下方', () => {
    const positions = layoutJourneyNodes(nodes, edges, 'horizontal');

    expect(positions.met!.y).toBeLessThan(positions.condition!.y);
    expect(positions.unmet!.y).toBeGreaterThan(positions.condition!.y);
    expect(positions.end!.x).toBeGreaterThan(positions.condition!.x);
  });

  it('空草稿返回空坐标表', () => {
    expect(layoutJourneyNodes([], [], 'vertical')).toEqual({});
  });

  it.each(['vertical', 'horizontal'] as const)(
    '%s布局按行为等待的“等到行为／超时”分支排列独占路径',
    (direction) => {
      const waitNode: JourneyDraftNode = {
        id: 'event-wait',
        type: 'wait_for_event',
        name: '等购买',
        position: { x: 0, y: 0 },
        eventType: 'purchase_completed',
        waitSeconds: 3_600,
        sameProduct: true,
      };
      const matched: JourneyDraftNode = {
        id: 'matched',
        type: 'end',
        name: '等到行为',
        position: { x: 0, y: 0 },
        note: null,
      };
      const timeout: JourneyDraftNode = {
        id: 'timeout',
        type: 'end',
        name: '超时',
        position: { x: 0, y: 0 },
        note: null,
      };
      const positions = layoutJourneyNodes(
        [nodes[0]!, waitNode, matched, timeout],
        [
          { id: 'to-wait', source: 'start', target: 'event-wait' },
          { id: 'matched-edge', source: 'event-wait', target: 'matched', branch: 'matched' },
          { id: 'timeout-edge', source: 'event-wait', target: 'timeout', branch: 'timeout' },
        ],
        direction,
      );
      const firstAxis = direction === 'vertical' ? 'x' : 'y';
      expect(positions.matched![firstAxis]).toBeLessThan(positions['event-wait']![firstAxis]);
      expect(positions.timeout![firstAxis]).toBeGreaterThan(positions['event-wait']![firstAxis]);
    },
  );

  it.each(['vertical', 'horizontal'] as const)(
    '遍历%s分支的后代，保留汇合与孤立节点',
    (direction) => {
      const extendedNodes: JourneyDraftNode[] = [
        ...nodes,
        {
          id: 'met-next',
          type: 'wait',
          name: '满足后继',
          position: { x: 0, y: 0 },
          waitSeconds: 30,
        },
        {
          id: 'unmet-next',
          type: 'wait',
          name: '不满足后继',
          position: { x: 0, y: 0 },
          waitSeconds: 30,
        },
        { id: 'isolated', type: 'end', name: '尚未连接', position: { x: 0, y: 0 }, note: null },
      ];
      const extendedEdges: JourneyDraftEdge[] = [
        ...edges.filter((edge) => edge.target !== 'end'),
        { id: 'met-next', source: 'met', target: 'met-next' },
        { id: 'unmet-next', source: 'unmet', target: 'unmet-next' },
        { id: 'met-join', source: 'met-next', target: 'end' },
        { id: 'unmet-join', source: 'unmet-next', target: 'end' },
      ];
      const positions = layoutJourneyNodes(extendedNodes, extendedEdges, direction);
      const crossAxis = direction === 'vertical' ? 'x' : 'y';
      const rankAxis = direction === 'vertical' ? 'y' : 'x';
      const metCenter = (positions.met![crossAxis] + positions['met-next']![crossAxis]) / 2;
      const unmetCenter = (positions.unmet![crossAxis] + positions['unmet-next']![crossAxis]) / 2;

      expect(metCenter).toBeLessThan(positions.condition![crossAxis]);
      expect(unmetCenter).toBeGreaterThan(positions.condition![crossAxis]);
      expect(positions.end![rankAxis]).toBeGreaterThan(positions['met-next']![rankAxis]);
      expect(positions.end![rankAxis]).toBeGreaterThan(positions['unmet-next']![rankAxis]);
      expect(Object.keys(positions).sort()).toEqual(extendedNodes.map((node) => node.id).sort());
      expect(Number.isFinite(positions.isolated!.x)).toBe(true);
      expect(Number.isFinite(positions.isolated!.y)).toBe(true);
    },
  );

  it.each(['vertical', 'horizontal'] as const)(
    '%s布局中的嵌套双分支末端不重叠，且各层分支方位保留',
    (direction) => {
      const nestedNodes: JourneyDraftNode[] = [
        nodes[0]!,
        { ...nodes[1]!, id: 'outer', name: '外层条件' },
        { ...nodes[1]!, id: 'met-inner', name: '满足路径条件' },
        { ...nodes[1]!, id: 'unmet-inner', name: '不满足路径条件' },
        { ...nodes[4]!, id: 'met-met', name: '满足后结束' },
        { ...nodes[4]!, id: 'met-unmet', name: '不满足后结束' },
        { ...nodes[4]!, id: 'unmet-met', name: '满足后结束' },
        { ...nodes[4]!, id: 'unmet-unmet', name: '不满足后结束' },
      ];
      const nestedEdges: JourneyDraftEdge[] = [
        { id: 'start-outer', source: 'start', target: 'outer' },
        { id: 'outer-met', source: 'outer', target: 'met-inner', branch: 'met' },
        { id: 'outer-unmet', source: 'outer', target: 'unmet-inner', branch: 'unmet' },
        { id: 'met-met', source: 'met-inner', target: 'met-met', branch: 'met' },
        { id: 'met-unmet', source: 'met-inner', target: 'met-unmet', branch: 'unmet' },
        { id: 'unmet-met', source: 'unmet-inner', target: 'unmet-met', branch: 'met' },
        { id: 'unmet-unmet', source: 'unmet-inner', target: 'unmet-unmet', branch: 'unmet' },
      ];
      const positions = layoutJourneyNodes(nestedNodes, nestedEdges, direction);
      const crossAxis = direction === 'vertical' ? 'x' : 'y';
      const terminalIds = ['met-met', 'met-unmet', 'unmet-met', 'unmet-unmet'];

      for (let left = 0; left < terminalIds.length; left += 1) {
        for (let right = left + 1; right < terminalIds.length; right += 1) {
          const a = positions[terminalIds[left]!]!;
          const b = positions[terminalIds[right]!]!;
          const separated =
            a.x + NODE_WIDTH <= b.x ||
            b.x + NODE_WIDTH <= a.x ||
            a.y + NODE_HEIGHT <= b.y ||
            b.y + NODE_HEIGHT <= a.y;
          expect(separated).toBe(true);
        }
      }

      expect(positions['met-inner']![crossAxis]).toBeLessThan(positions.outer![crossAxis]);
      expect(positions['unmet-inner']![crossAxis]).toBeGreaterThan(positions.outer![crossAxis]);
      expect(positions['met-met']![crossAxis]).toBeLessThan(positions['met-inner']![crossAxis]);
      expect(positions['met-unmet']![crossAxis]).toBeGreaterThan(
        positions['met-inner']![crossAxis],
      );
      expect(positions['unmet-met']![crossAxis]).toBeLessThan(positions['unmet-inner']![crossAxis]);
      expect(positions['unmet-unmet']![crossAxis]).toBeGreaterThan(
        positions['unmet-inner']![crossAxis],
      );
    },
  );
});
