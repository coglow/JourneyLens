import { act, cleanup, renderHook } from '@testing-library/react';
import type { JourneyDraftDefinition } from '@journeylens/shared';
import type { ReactFlowInstance } from '@xyflow/react';
import type { JourneyCanvasFlowNode } from '@/features/journeys/components/JourneyCanvasNode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useJourneyCanvas } from './useJourneyCanvas';

const start = {
  id: 'start',
  type: 'start' as const,
  name: '开始',
  position: { x: 0, y: 0 },
  entryBehavior: 'product_viewed' as const,
};

const condition = {
  id: 'condition',
  type: 'condition' as const,
  name: '条件分支',
  position: { x: 0, y: 200 },
  rules: {
    kind: 'compare' as const,
    left: { source: 'user' as const, path: 'vipLevel' as const },
    operator: 'in' as const,
  },
};

const message = {
  id: 'message',
  type: 'message' as const,
  name: '消息',
  position: { x: 0, y: 200 },
  channel: 'sms' as const,
  subject: null,
  body: '',
};

const end = {
  id: 'end',
  type: 'end' as const,
  name: '结束',
  position: { x: 0, y: 400 },
  note: null,
};

type CanvasHook = ReturnType<typeof useJourneyCanvas>;

function nodeOf(result: { current: CanvasHook }, id: string) {
  return result.current.nodes.find((node) => node.id === id);
}

function getNodeName(result: { current: CanvasHook }, id: string): string | undefined {
  return nodeOf(result, id)?.data.draftNode.name;
}

function getMessageBody(result: { current: CanvasHook }, id: string): string | undefined {
  const node = nodeOf(result, id)?.data.draftNode;
  return node?.type === 'message' ? node.body : undefined;
}

function renameNode(result: { current: CanvasHook }, id: string, name: string): void {
  act(() => {
    const node = nodeOf(result, id)?.data.draftNode;
    if (node === undefined) throw new Error(`节点 ${id} 不存在`);
    result.current.updateNode({ ...node, name });
  });
}

function setMessageBody(result: { current: CanvasHook }, id: string, body: string): void {
  act(() => {
    const node = nodeOf(result, id)?.data.draftNode;
    if (node?.type !== 'message') throw new Error(`节点 ${id} 不是消息步骤`);
    result.current.updateNode({ ...node, body });
  });
}

function moveNode(
  result: { current: CanvasHook },
  id: string,
  position: { x: number; y: number },
  dragging = false,
): void {
  act(() => {
    result.current.onNodesChange([{ id, type: 'position', position, dragging }]);
  });
}

function renderCanvas() {
  const hook = renderHook(() => useJourneyCanvas());
  hook.result.current.flowInstance.current = {
    screenToFlowPosition: (position) => position,
  } as ReactFlowInstance<JourneyCanvasFlowNode>;
  return hook;
}

describe('旅程画布连接操作', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('问题定位交给画布按节点标识适配，保留缩放和焦点选择且不产生修改历史', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    const { result } = renderCanvas();
    const initial: JourneyDraftDefinition = {
      layoutDirection: 'vertical',
      nodes: [start, condition],
      edges: [],
    };
    act(() => result.current.resetDefinition(initial));
    const fitView = vi.fn().mockResolvedValue(true);
    const setCenter = vi.fn();
    Object.assign(result.current.flowInstance.current!, { fitView, setCenter });

    act(() => result.current.selectNodeForIssue('condition'));

    expect(fitView).toHaveBeenCalledExactlyOnceWith({
      nodes: [{ id: 'condition' }],
      minZoom: 1.1,
      maxZoom: 1.1,
      duration: 250,
    });
    expect(setCenter).not.toHaveBeenCalled();
    expect(result.current.selectedNode?.id).toBe('condition');
    expect(result.current.selectedNodeIds).toEqual(['condition']);
    expect(result.current.selectedEdgeIds).toEqual([]);
    expect(result.current.currentDefinition).toEqual(initial);
    expect(result.current.canUndo).toBe(false);
  });

  it('一次快捷新增同时记录节点和连线，撤销与重做各一步完成', () => {
    const { result } = renderCanvas();
    const initial: JourneyDraftDefinition = {
      layoutDirection: 'vertical',
      nodes: [start],
      edges: [],
    };
    act(() => result.current.resetDefinition(initial));

    let added = false;
    act(() => {
      added = result.current.addConnectedNode('message', 'start', undefined, { x: 118, y: 300 });
    });

    expect(added).toBe(true);
    expect(result.current.nodes).toHaveLength(2);
    expect(result.current.edges).toHaveLength(1);
    expect(result.current.edges[0]).toMatchObject({ source: 'start', sourceHandle: 'next' });
    expect(result.current.selectedNode?.data.draftNode.type).toBe('message');
    expect(result.current.parsedDefinition.success).toBe(false);

    act(() => result.current.undo());
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.edges).toHaveLength(0);

    act(() => result.current.redo());
    expect(result.current.nodes).toHaveLength(2);
    expect(result.current.edges).toHaveLength(1);
  });

  it('允许未填完配置的节点继续建立普通连线', () => {
    const { result } = renderCanvas();
    const initial: JourneyDraftDefinition = {
      layoutDirection: 'vertical',
      nodes: [
        start,
        {
          id: 'message',
          type: 'message',
          name: '消息',
          position: { x: 0, y: 200 },
          channel: 'sms',
          subject: null,
          body: '',
        },
      ],
      edges: [],
    };
    act(() => result.current.resetDefinition(initial));

    let connected = false;
    act(() => {
      connected = result.current.handleConnect({
        source: 'start',
        target: 'message',
        sourceHandle: 'next',
        targetHandle: 'target',
      });
    });

    expect(connected).toBe(true);
    expect(result.current.edges).toHaveLength(1);
    expect(result.current.parsedDefinition.success).toBe(false);
    expect(result.current.issues.some((issue) => issue.message === '消息内容不能为空')).toBe(true);
  });

  it('配置未完成时仍可粘贴节点，其他节点的问题也不会挡住粘贴', () => {
    const { result } = renderCanvas();
    act(() =>
      result.current.resetDefinition({
        layoutDirection: 'vertical',
        nodes: [start, condition, message],
        edges: [],
      }),
    );
    const selectedMessage = result.current.nodes.find((node) => node.id === 'message')!;
    act(() => result.current.onSelectionChange({ nodes: [selectedMessage], edges: [] }));
    act(() => result.current.copySelection());

    let pasted = false;
    act(() => {
      pasted = result.current.pasteSelection();
    });

    expect(pasted).toBe(true);
    expect(
      result.current.nodes.filter((node) => node.data.draftNode.type === 'message'),
    ).toHaveLength(2);
    expect(result.current.parsedDefinition.success).toBe(false);
    expect(result.current.issues.map((issue) => issue.message)).toContain('消息内容不能为空');
    expect(result.current.issues.map((issue) => issue.message)).toContain('请填写比较值');
  });

  it('找不到可放置位置时提示原因', () => {
    const noSpace = renderCanvas();
    act(() =>
      noSpace.result.current.resetDefinition({
        layoutDirection: 'vertical',
        nodes: [start],
        edges: [],
      }),
    );
    act(() => {
      noSpace.result.current.addConnectedNode('wait', 'start', undefined, {
        x: 1_000_000,
        y: 1_000_000,
      });
    });
    expect(noSpace.result.current.canvasErrors).toEqual([
      '找不到可放置步骤的位置，请调整画布后重试。',
    ]);
  });

  it('条件分支快捷新增保留满足和不满足标记且分别占用各自路径', () => {
    const { result } = renderCanvas();
    const initial: JourneyDraftDefinition = {
      layoutDirection: 'vertical',
      nodes: [start, condition],
      edges: [],
    };
    act(() => result.current.resetDefinition(initial));

    let metAdded = false;
    act(() => {
      metAdded = result.current.addConnectedNode('wait', 'condition', 'met', {
        x: -100,
        y: 400,
      });
    });
    let unmetAdded = false;
    act(() => {
      unmetAdded = result.current.addConnectedNode('end', 'condition', 'unmet', {
        x: 300,
        y: 400,
      });
    });

    expect(metAdded).toBe(true);
    expect(unmetAdded).toBe(true);
    expect(result.current.edges.map((edge) => [edge.sourceHandle, edge.label])).toEqual([
      ['met', '满足'],
      ['unmet', '不满足'],
    ]);
    expect(result.current.canQuickAddFrom('condition', 'met')).toBe(false);
    expect(result.current.canQuickAddFrom('condition', 'unmet')).toBe(false);
  });
});

describe('旅程画布撤销与重做范围', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('撤销、重做只恢复节点位置，修改后的配置在两步之间都保留', () => {
    const { result } = renderCanvas();
    act(() =>
      result.current.resetDefinition({
        layoutDirection: 'vertical',
        nodes: [start, message],
        edges: [],
      }),
    );
    expect(result.current.canUndo).toBe(false);

    moveNode(result, 'message', { x: 0, y: 300 });
    setMessageBody(result, 'message', '修改后的正文');
    moveNode(result, 'message', { x: 0, y: 400 });

    act(() => result.current.undo());
    expect(nodeOf(result, 'message')?.position).toEqual({ x: 0, y: 300 });
    expect(getMessageBody(result, 'message')).toBe('修改后的正文');

    act(() => result.current.redo());
    expect(nodeOf(result, 'message')?.position).toEqual({ x: 0, y: 400 });
    expect(getMessageBody(result, 'message')).toBe('修改后的正文');
  });

  it('连续修改节点配置不占用画布历史，之前的画布操作仍可撤销', () => {
    const { result } = renderCanvas();
    act(() =>
      result.current.resetDefinition({ layoutDirection: 'vertical', nodes: [start], edges: [] }),
    );
    act(() => {
      result.current.addConnectedNode('end', 'start', undefined, { x: 118, y: 300 });
    });
    const endId = result.current.nodes.find((node) => node.data.draftNode.type === 'end')!.id;

    for (let index = 0; index < 60; index += 1) {
      renameNode(result, endId, `结束 ${index}`);
    }

    expect(getNodeName(result, endId)).toBe('结束 59');
    expect(result.current.nodes).toHaveLength(2);
    act(() => result.current.undo());
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.edges).toHaveLength(0);
  });

  it('删除节点后撤销，恢复节点、关联连线和删除前的最新配置', () => {
    const { result } = renderCanvas();
    act(() =>
      result.current.resetDefinition({
        layoutDirection: 'vertical',
        nodes: [start, end],
        edges: [{ id: 'start-end', source: 'start', target: 'end' }],
      }),
    );
    renameNode(result, 'end', '删除前名称');
    act(() => {
      result.current.deleteSelected(['end'], []);
    });
    expect(nodeOf(result, 'end')).toBeUndefined();
    expect(result.current.edges).toHaveLength(0);

    act(() => result.current.undo());
    expect(getNodeName(result, 'end')).toBe('删除前名称');
    expect(result.current.edges).toHaveLength(1);
  });

  it('撤销新增后重做，恢复该步骤及新增后修改的配置', () => {
    const { result } = renderCanvas();
    act(() =>
      result.current.resetDefinition({ layoutDirection: 'vertical', nodes: [start], edges: [] }),
    );
    act(() => {
      result.current.addConnectedNode('message', 'start', undefined, { x: 118, y: 300 });
    });
    const messageId = result.current.nodes.find(
      (node) => node.data.draftNode.type === 'message',
    )!.id;
    setMessageBody(result, messageId, '欢迎加入');

    act(() => result.current.undo());
    expect(nodeOf(result, messageId)).toBeUndefined();
    act(() => result.current.redo());
    expect(getMessageBody(result, messageId)).toBe('欢迎加入');
  });

  it('拖动过程不记录，落点只记录一次，重复落在相同位置不新增记录', () => {
    const { result } = renderCanvas();
    act(() =>
      result.current.resetDefinition({
        layoutDirection: 'vertical',
        nodes: [message],
        edges: [],
      }),
    );

    act(() => result.current.startDrag());
    moveNode(result, 'message', { x: 0, y: 220 }, true);
    expect(result.current.dragging).toBe(true);
    expect(result.current.canUndo).toBe(false);

    act(() => {
      result.current.onNodesChange([
        { id: 'message', type: 'position', position: { x: 0, y: 240 }, dragging: false },
      ]);
      result.current.finishDrag();
    });
    expect(result.current.dragging).toBe(false);
    expect(result.current.canUndo).toBe(true);

    moveNode(result, 'message', { x: 0, y: 240 });
    act(() => result.current.undo());
    expect(result.current.canUndo).toBe(false);
    expect(nodeOf(result, 'message')?.position).toEqual({ x: 0, y: 200 });
  });

  it('方向键移动节点记录一个撤销点', () => {
    const { result } = renderCanvas();
    act(() =>
      result.current.resetDefinition({ layoutDirection: 'vertical', nodes: [start], edges: [] }),
    );

    moveNode(result, 'start', { x: 5, y: 0 });
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(nodeOf(result, 'start')?.position).toEqual({ x: 0, y: 0 });
  });
});
