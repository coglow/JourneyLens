import { describe, expect, it } from 'vitest';
import type { JourneyDraftDefinition, JourneyDraftNode } from '@journeylens/shared';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  findOpenPosition,
  journeyBranchFromHandle,
  newDraftNode,
  pasteClipboard,
  toDraftEdge,
  toFlowEdge,
  toFlowNode,
} from './journey-canvas';

const messageNode: JourneyDraftNode = {
  id: 'message',
  type: 'message',
  name: '消息',
  position: { x: 0, y: 0 },
  channel: 'sms',
  subject: null,
  body: '',
};

const startNode: JourneyDraftNode = {
  id: 'start',
  type: 'start',
  name: '开始',
  position: { x: 0, y: 0 },
  entryBehavior: 'product_viewed',
};

const waitNode: JourneyDraftNode = {
  id: 'wait',
  type: 'wait',
  name: '等待',
  position: { x: 0, y: 240 },
  waitSeconds: 60,
};

function overlapsOwnNode(position: { x: number; y: number }, node: JourneyDraftNode): boolean {
  return (
    position.x < node.position.x + NODE_WIDTH + 16 &&
    position.x + NODE_WIDTH > node.position.x - 16 &&
    position.y < node.position.y + NODE_HEIGHT + 16 &&
    position.y + NODE_HEIGHT > node.position.y - 16
  );
}

describe('旅程新增步骤位置', () => {
  it('空白处直接使用指针位置的中心点', () => {
    const placement = findOpenPosition({ x: 800, y: 800 }, [toFlowNode(messageNode, 'vertical')]);

    expect(placement).toEqual({
      status: 'found',
      position: { x: 800 - NODE_WIDTH / 2, y: 800 - NODE_HEIGHT / 2 },
    });
  });

  it('中心被已有节点占用时让到最近的不重叠位置', () => {
    const placement = findOpenPosition({ x: 118, y: 52 }, [toFlowNode(messageNode, 'vertical')]);

    expect(placement.status).toBe('found');
    if (placement.status === 'found') {
      expect(overlapsOwnNode(placement.position, messageNode)).toBe(false);
    }
  });

  it('多个节点占满周围时仍返回不与任何节点重叠的位置', () => {
    const nodes = [
      { ...messageNode, id: 'a', position: { x: -272, y: -136 } },
      { ...messageNode, id: 'b', position: { x: 0, y: -136 } },
      { ...messageNode, id: 'c', position: { x: 272, y: -136 } },
      { ...messageNode, id: 'd', position: { x: -272, y: 0 } },
      { ...messageNode, id: 'e', position: { x: 0, y: 0 } },
      { ...messageNode, id: 'f', position: { x: 272, y: 0 } },
      { ...messageNode, id: 'g', position: { x: -272, y: 136 } },
      { ...messageNode, id: 'h', position: { x: 0, y: 136 } },
      { ...messageNode, id: 'i', position: { x: 272, y: 136 } },
    ].map((node) => toFlowNode(node, 'vertical'));

    const placement = findOpenPosition({ x: 118, y: 52 }, nodes);

    expect(placement.status).toBe('found');
    if (placement.status === 'found') {
      for (const node of nodes) {
        expect(overlapsOwnNode(placement.position, node.data.draftNode)).toBe(false);
      }
    }
  });

  it('超出可放置坐标范围时返回失败，不退回重叠位置', () => {
    const node = toFlowNode({ ...startNode, position: { x: 100_001, y: 100_001 } }, 'vertical');

    expect(findOpenPosition({ x: 1_000_000, y: 1_000_000 }, [node])).toEqual({
      status: 'not-found',
    });
  });
});

describe('旅程画布粘贴', () => {
  const definition: JourneyDraftDefinition = {
    layoutDirection: 'vertical',
    nodes: [startNode],
    edges: [],
  };

  it('重建节点和连线标识，保留分支标记并逐次错开位置', () => {
    const clipboard = {
      nodes: [messageNode, waitNode],
      edges: [{ id: 'copied-edge', source: 'message', target: 'wait' }],
    };

    const first = pasteClipboard(definition, clipboard, 0);
    const second = pasteClipboard(definition, clipboard, 1);

    expect(first.status).toBe('pasted');
    expect(second.status).toBe('pasted');
    if (first.status !== 'pasted' || second.status !== 'pasted') return;

    expect(first.definition.nodes).toHaveLength(3);
    expect(first.definition.nodes.map((node) => node.id)).not.toContain('message');
    expect(first.definition.edges[0]).toMatchObject({
      source: first.nodeIds[0],
      target: first.nodeIds[1],
    });
    expect(first.definition.nodes[2]!.position).toEqual({ x: 40, y: 280 });
    expect(second.definition.nodes[2]!.position).toEqual({ x: 80, y: 320 });
    // 原草稿不被修改，连续粘贴互不影响。
    expect(definition.nodes).toHaveLength(1);
  });

  it('已有开始节点时拒绝粘贴开始节点', () => {
    const result = pasteClipboard(
      definition,
      {
        nodes: [{ ...startNode, id: 'another-start' }],
        edges: [],
      },
      0,
    );

    expect(result).toEqual({
      status: 'error',
      message: '一条旅程只能有一个开始节点，当前内容无法粘贴。',
    });
  });

  it('配置尚未填完的节点也允许粘贴', () => {
    const result = pasteClipboard(definition, { nodes: [{ ...messageNode }], edges: [] }, 0);

    expect(result.status).toBe('pasted');
  });

  it('超过节点上限时拒绝粘贴', () => {
    const nodes = Array.from({ length: 30 }, (_, index) => ({
      ...messageNode,
      id: `node-${index}`,
    }));
    const result = pasteClipboard({ ...definition, nodes }, { nodes: [messageNode], edges: [] }, 0);

    expect(result.status).toBe('error');
  });
});

describe('行为等待分支画布映射', () => {
  it('只从对应节点类型的连接点读取分支', () => {
    expect(journeyBranchFromHandle('condition', 'met')).toBe('met');
    expect(journeyBranchFromHandle('wait_for_event', 'timeout')).toBe('timeout');
    expect(journeyBranchFromHandle('wait_for_event', 'met')).toBeUndefined();
    expect(journeyBranchFromHandle('wait', 'matched')).toBeUndefined();
  });

  it('保存往返保留等到行为和超时标记', () => {
    for (const branch of ['matched', 'timeout'] as const) {
      const edge = { id: `edge-${branch}`, source: 'wait', target: 'end', branch };
      expect(toDraftEdge(toFlowEdge(edge))).toEqual(edge);
      expect(toFlowEdge(edge).labelBgStyle?.fill).toBe('var(--ant-color-bg-container)');
    }
  });

  it('新增的行为等待步骤带默认购买和商品关联设置', () => {
    expect(newDraftNode('wait_for_event', { x: 40, y: 80 })).toMatchObject({
      type: 'wait_for_event',
      eventType: 'purchase_completed',
      waitSeconds: 86_400,
      sameProduct: true,
    });
  });
});
