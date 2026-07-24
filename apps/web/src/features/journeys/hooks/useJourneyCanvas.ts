import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  JOURNEY_NODE_LIMIT,
  getJourneyDraftGraphIssues,
  getJourneyDraftWarnings,
  journeyDraftDefinitionSchema,
  type ConditionBranch,
  type JourneyDraftDefinition,
  type JourneyDraftNode,
  type JourneyLayoutDirection,
  type JourneyNodeType,
} from '@journeylens/shared';
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import type { JourneyCanvasFlowNode } from '@/features/journeys/components/JourneyCanvasNode';
import {
  findOpenPosition,
  getNextStepIssue,
  isConnectionReady,
  newDraftEdge,
  newDraftNode,
  pasteClipboard,
  toCanvasDefinition,
  toCanvasSnapshot,
  toDefinition,
  toFlowEdge,
  toFlowNode,
  type CanvasSnapshot,
  type DraftIssue,
  type JourneyClipboard,
} from '@/features/journeys/journey-canvas';
import { layoutJourneyNodes } from '@/features/journeys/journey-layout';

const MAX_HISTORY_ENTRIES = 50;
export const fitViewOptions = { padding: 0.18 };

const EMPTY_CANVAS_SNAPSHOT: CanvasSnapshot = {
  layoutDirection: 'vertical',
  nodes: [],
  edges: [],
};

/** 维护画布编辑状态；是否允许编辑及保存反馈由页面统一协调。编辑操作返回是否生效。 */
export function useJourneyCanvas() {
  const [nodes, setNodes] = useState<JourneyCanvasFlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [layoutDirection, setLayoutDirection] = useState<JourneyLayoutDirection>('vertical');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [canvasErrors, setCanvasErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [history, setHistory] = useState<{ entries: CanvasSnapshot[]; index: number }>({
    entries: [EMPTY_CANVAS_SNAPSHOT],
    index: 0,
  });
  // 撤销、重做只恢复画布，仍存在的节点取这里的最新配置；节点消失后恢复也用它。
  const nodeConfigs = useRef(new Map<string, JourneyDraftNode>());
  const clipboard = useRef<JourneyClipboard | null>(null);
  const pasteCount = useRef(0);
  const canvasElement = useRef<HTMLDivElement>(null);
  const flowInstance = useRef<ReactFlowInstance<JourneyCanvasFlowNode, Edge> | null>(null);
  const focusSettingsAfterSelect = useRef(false);
  const nodeSettingsHeading = useRef<HTMLDivElement>(null);
  const fitCanvas = useCallback((): void => {
    window.requestAnimationFrame(() => {
      void flowInstance.current?.fitView(fitViewOptions);
    });
  }, []);

  const hasClipboard = useCallback((): boolean => clipboard.current !== null, []);

  /** 选中状态同时写入标识列表和节点的 selected 字段：React Flow 靠后者决定高亮与连线。 */
  const selectOnly = useCallback((nodeIds: string[], edgeIds: string[]): void => {
    const nodeIdSet = new Set(nodeIds);
    const edgeIdSet = new Set(edgeIds);
    setSelectedNodeIds(nodeIds);
    setSelectedEdgeIds(edgeIds);
    setNodes((current) => current.map((node) => ({ ...node, selected: nodeIdSet.has(node.id) })));
    setEdges((current) => current.map((edge) => ({ ...edge, selected: edgeIdSet.has(edge.id) })));
  }, []);

  // 历史只保存画布内容，不保存节点配置和选中状态；最多保留 50 份快照。
  const resetHistory = useCallback((definition: JourneyDraftDefinition): void => {
    setHistory({ entries: [toCanvasSnapshot(definition)], index: 0 });
  }, []);

  const recordHistory = useCallback((snapshot: CanvasSnapshot): void => {
    setHistory((current) => {
      const currentSnapshot = current.entries[current.index];
      if (currentSnapshot && JSON.stringify(currentSnapshot) === JSON.stringify(snapshot)) {
        return current;
      }

      const entries = current.entries.slice(0, current.index + 1);
      entries.push(snapshot);
      if (entries.length > MAX_HISTORY_ENTRIES) entries.shift();
      return { entries, index: entries.length - 1 };
    });
  }, []);

  const applyCanvasContent = useCallback(
    (
      canvasNodes: JourneyCanvasFlowNode[],
      canvasEdges: Edge[],
      direction: JourneyLayoutDirection,
    ): void => {
      const directionChanged = direction !== layoutDirection;
      const nodeIds = new Set(canvasNodes.map((node) => node.id));
      const edgeIds = new Set(canvasEdges.map((edge) => edge.id));
      setNodes(canvasNodes);
      setEdges(canvasEdges);
      setLayoutDirection(direction);
      selectOnly(
        selectedNodeIds.filter((nodeId) => nodeIds.has(nodeId)),
        selectedEdgeIds.filter((edgeId) => edgeIds.has(edgeId)),
      );
      setCanvasErrors([]);
      if (directionChanged) fitCanvas();
    },
    [fitCanvas, layoutDirection, selectOnly, selectedEdgeIds, selectedNodeIds],
  );

  /** 应用完整草稿；节点配置在此登记为最新值，供撤销、重做恢复画布时使用。 */
  const applyDefinition = useCallback(
    (definition: JourneyDraftDefinition): void => {
      for (const node of definition.nodes) nodeConfigs.current.set(node.id, node);
      const canvas = toCanvasDefinition(definition);
      applyCanvasContent(canvas.nodes, canvas.edges, definition.layoutDirection);
    },
    [applyCanvasContent],
  );

  /** 画布结构或布局变化提交一次，同时留下一个撤销点。 */
  const commitDefinition = useCallback(
    (definition: JourneyDraftDefinition): void => {
      recordHistory(toCanvasSnapshot(definition));
      applyDefinition(definition);
    },
    [applyDefinition, recordHistory],
  );

  /** 撤销、重做只恢复快照中的画布内容，节点配置始终取最新值。 */
  const applyCanvasSnapshot = useCallback(
    (snapshot: CanvasSnapshot): void => {
      const snapshotNodes = snapshot.nodes.flatMap(({ id, position }) => {
        const config = nodeConfigs.current.get(id);
        // 进入过画布的节点都会登记配置，正常流程不会缺少。
        if (config === undefined) return [];
        return [toFlowNode({ ...config, position }, snapshot.layoutDirection)];
      });
      applyCanvasContent(snapshotNodes, snapshot.edges.map(toFlowEdge), snapshot.layoutDirection);
    },
    [applyCanvasContent],
  );
  const canUndo = history.index > 0;
  const canRedo = history.index < history.entries.length - 1;

  /** 仅在首次读取或明确接受服务器内容时重置历史、选择和剪贴板。 */
  const resetDefinition = useCallback(
    (definition: JourneyDraftDefinition): void => {
      const canvas = toCanvasDefinition(definition);
      // 新基准丢弃旧画布，节点配置缓存与历史一起重建。
      nodeConfigs.current = new Map(definition.nodes.map((node) => [node.id, node]));
      setNodes(canvas.nodes);
      setEdges(canvas.edges);
      setLayoutDirection(definition.layoutDirection);
      resetHistory(definition);
      clipboard.current = null;
      pasteCount.current = 0;
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setDragging(false);
    },
    [resetHistory],
  );

  const currentDefinition = useMemo(
    () => toDefinition(nodes, edges, layoutDirection),
    [edges, layoutDirection, nodes],
  );
  const parsedDefinition = useMemo(
    () => journeyDraftDefinitionSchema.safeParse(currentDefinition),
    [currentDefinition],
  );
  const issues = useMemo<DraftIssue[]>(() => {
    if (parsedDefinition.success) return [];
    return parsedDefinition.error.issues.map((issue, index) => {
      const nodeIndex = issue.path[0] === 'nodes' ? issue.path[1] : undefined;
      const nodeId = typeof nodeIndex === 'number' ? nodes[nodeIndex]?.id : undefined;
      return {
        message: issue.message,
        ...(nodeId === undefined ? {} : { nodeId }),
        path: issue.path,
        key: `${issue.path.join('.')}-${index}`,
      };
    });
  }, [nodes, parsedDefinition]);
  const warnings = useMemo(() => getJourneyDraftWarnings(currentDefinition), [currentDefinition]);
  // 设置面板只认最后一个选中的对象：有节点时优先节点，否则取连线。
  const selectedNodeId = selectedNodeIds.at(-1);
  const selectedEdgeId = selectedNodeId === undefined ? selectedEdgeIds.at(-1) : undefined;
  const selectedNode =
    selectedNodeId === undefined ? undefined : nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge =
    selectedEdgeId === undefined ? undefined : edges.find((edge) => edge.id === selectedEdgeId);

  const undo = useCallback((): boolean => {
    if (!canUndo) return false;
    const nextIndex = history.index - 1;
    applyCanvasSnapshot(history.entries[nextIndex]!);
    setHistory({ entries: history.entries, index: nextIndex });
    return true;
  }, [applyCanvasSnapshot, canUndo, history]);

  const redo = useCallback((): boolean => {
    if (!canRedo) return false;
    const nextIndex = history.index + 1;
    applyCanvasSnapshot(history.entries[nextIndex]!);
    setHistory({ entries: history.entries, index: nextIndex });
    return true;
  }, [applyCanvasSnapshot, canRedo, history]);

  // 复制节点时保留所选节点之间的连线；单独复制连线时也一并复制两个端点。
  const copySelection = useCallback((): void => {
    const nodeIds = new Set(selectedNodeIds);
    const edgeIds = new Set(selectedEdgeIds);
    const copiedEdges = currentDefinition.edges.filter(
      (edge) => edgeIds.has(edge.id) || (nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    );
    for (const edge of copiedEdges) {
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }
    const copiedNodes = currentDefinition.nodes.filter((node) => nodeIds.has(node.id));
    if (copiedNodes.length === 0) return;

    clipboard.current = { nodes: structuredClone(copiedNodes), edges: copiedEdges };
    pasteCount.current = 0;
  }, [currentDefinition, selectedEdgeIds, selectedNodeIds]);

  const pasteSelection = useCallback((): boolean => {
    const copied = clipboard.current;
    if (copied === null) return false;

    const result = pasteClipboard(currentDefinition, copied, pasteCount.current);
    if (result.status === 'error') {
      setCanvasErrors([result.message]);
      return false;
    }

    pasteCount.current += 1;
    commitDefinition(result.definition);
    selectOnly(result.nodeIds, []);
    return true;
  }, [commitDefinition, currentDefinition, selectOnly]);

  const onNodesChange = useCallback(
    (changes: NodeChange<JourneyCanvasFlowNode>[]) => {
      setNodes((current) => applyNodeChanges(changes, current));
      // 拖动落下和方向键移动都以「非拖动」的位置变化到达，各算一次有效画布操作；
      // 拖动过程中的位置变化不记录，因此一次拖动只留下一个撤销点。
      if (changes.some((change) => change.type === 'position' && change.dragging === false)) {
        // 快照只需要标识和坐标，位置变化自带绝对坐标，可直接合并到当前节点。
        const movedNodes = applyNodeChanges(changes, nodes);
        recordHistory(toCanvasSnapshot(toDefinition(movedNodes, edges, layoutDirection)));
      }
    },
    [edges, layoutDirection, nodes, recordHistory],
  );
  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);
  const onSelectionChange = useCallback(
    ({
      nodes: selectedNodes,
      edges: selectedEdges,
    }: {
      nodes: JourneyCanvasFlowNode[];
      edges: Edge[];
    }) => {
      const nodeIds = selectedNodes.map((node) => node.id);
      const edgeIds = selectedEdges.map((edge) => edge.id);
      setSelectedNodeIds((current) =>
        current.length === nodeIds.length &&
        current.every((value, index) => value === nodeIds[index])
          ? current
          : nodeIds,
      );
      setSelectedEdgeIds((current) =>
        current.length === edgeIds.length &&
        current.every((value, index) => value === edgeIds[index])
          ? current
          : edgeIds,
      );
    },
    [],
  );
  useEffect(() => {
    if (focusSettingsAfterSelect.current) {
      focusSettingsAfterSelect.current = false;
      nodeSettingsHeading.current?.focus();
    }
  }, [selectedNode]);

  const updateNode = useCallback(
    (nextNode: JourneyDraftNode): boolean => {
      // 配置修改只更新草稿，不进入画布历史；自动保存和未保存判断仍以草稿为准。
      applyDefinition({
        ...currentDefinition,
        nodes: currentDefinition.nodes.map((node) =>
          node.id === nextNode.id ? { ...nextNode, position: node.position } : node,
        ),
      });
      return true;
    },
    [applyDefinition, currentDefinition],
  );

  const addNode = useCallback(
    (type: JourneyNodeType): boolean => {
      if (currentDefinition.nodes.length >= JOURNEY_NODE_LIMIT) {
        setCanvasErrors([`最多添加 ${JOURNEY_NODE_LIMIT} 个节点。`]);
        return false;
      }
      if (type === 'start' && currentDefinition.nodes.some((node) => node.type === 'start')) {
        setCanvasErrors(['一条旅程只能有一个开始节点。']);
        return false;
      }

      const bounds = canvasElement.current?.getBoundingClientRect();
      const screenCenter = bounds
        ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
        : { x: 0, y: 0 };
      const center = flowInstance.current?.screenToFlowPosition(screenCenter) ?? screenCenter;
      const placement = findOpenPosition(center, nodes);
      if (placement.status !== 'found') {
        setCanvasErrors(['找不到可放置步骤的位置，请调整画布后重试。']);
        return false;
      }

      commitDefinition({
        ...currentDefinition,
        nodes: [...currentDefinition.nodes, newDraftNode(type, placement.position)],
      });
      return true;
    },
    [commitDefinition, currentDefinition, nodes],
  );

  const handleConnect = useCallback(
    (connection: Connection): boolean => {
      if (!isConnectionReady(connection)) {
        setCanvasErrors(['请选择要连接的两个节点。']);
        return false;
      }

      const source = currentDefinition.nodes.find((node) => node.id === connection.source);
      const handle = connection.sourceHandle;
      const branch =
        source?.type === 'condition' && (handle === 'met' || handle === 'unmet')
          ? handle
          : undefined;
      const candidate = {
        ...currentDefinition,
        edges: [
          ...currentDefinition.edges,
          newDraftEdge(connection.source, connection.target, branch),
        ],
      };
      const graphIssue = getJourneyDraftGraphIssues(candidate.nodes, candidate.edges)[0];
      if (graphIssue !== undefined) {
        setCanvasErrors([graphIssue.message]);
        return false;
      }

      commitDefinition(candidate);
      return true;
    },
    [commitDefinition, currentDefinition],
  );

  const canQuickAddFrom = useCallback(
    (sourceId: string, branch?: ConditionBranch): boolean => {
      const issue = getNextStepIssue(currentDefinition, sourceId, branch);
      setCanvasErrors(issue === undefined ? [] : [issue]);
      return issue === undefined;
    },
    [currentDefinition],
  );

  const addConnectedNode = useCallback(
    (
      type: JourneyNodeType,
      sourceId: string,
      branch: ConditionBranch | undefined,
      center: { x: number; y: number },
    ): boolean => {
      const issue = getNextStepIssue(currentDefinition, sourceId, branch);
      if (issue !== undefined) {
        setCanvasErrors([issue]);
        return false;
      }

      const placement = findOpenPosition(center, nodes);
      if (placement.status !== 'found') {
        setCanvasErrors(['找不到可放置步骤的位置，请调整画布后重试。']);
        return false;
      }

      const draftNode = newDraftNode(type, placement.position);
      const candidate = {
        ...currentDefinition,
        nodes: [...currentDefinition.nodes, draftNode],
        edges: [...currentDefinition.edges, newDraftEdge(sourceId, draftNode.id, branch)],
      };
      const graphIssue = getJourneyDraftGraphIssues(candidate.nodes, candidate.edges)[0];
      if (graphIssue !== undefined) {
        setCanvasErrors([graphIssue.message]);
        return false;
      }

      commitDefinition(candidate);
      selectOnly([draftNode.id], []);
      focusSettingsAfterSelect.current = true;
      setCanvasErrors([]);
      return true;
    },
    [commitDefinition, currentDefinition, nodes, selectOnly],
  );

  /** 按给定方向重新计算所有坐标，布局方向和自动排列共用这一份计算。 */
  const commitLayout = useCallback(
    (direction: JourneyLayoutDirection): void => {
      const positions = layoutJourneyNodes(
        currentDefinition.nodes,
        currentDefinition.edges,
        direction,
      );
      commitDefinition({
        ...currentDefinition,
        layoutDirection: direction,
        nodes: currentDefinition.nodes.map((node) => ({
          ...node,
          position: positions[node.id] ?? node.position,
        })),
      });
      fitCanvas();
    },
    [commitDefinition, currentDefinition, fitCanvas],
  );

  const changeLayoutDirection = useCallback(
    (nextDirection: JourneyLayoutDirection): boolean => {
      if (nextDirection === layoutDirection) return false;
      commitLayout(nextDirection);
      return true;
    },
    [commitLayout, layoutDirection],
  );

  const autoArrange = useCallback((): boolean => {
    if (currentDefinition.nodes.length < 2) return false;
    commitLayout(currentDefinition.layoutDirection);
    return true;
  }, [commitLayout, currentDefinition]);

  const deleteSelected = useCallback(
    (nodeIds = selectedNodeIds, edgeIds = selectedEdgeIds): boolean => {
      if (nodeIds.length === 0 && edgeIds.length === 0) return false;
      const nodeIdSet = new Set(nodeIds);
      const edgeIdSet = new Set(edgeIds);
      commitDefinition({
        ...currentDefinition,
        nodes: currentDefinition.nodes.filter((node) => !nodeIdSet.has(node.id)),
        edges: currentDefinition.edges.filter(
          (edge) =>
            !edgeIdSet.has(edge.id) && !nodeIdSet.has(edge.source) && !nodeIdSet.has(edge.target),
        ),
      });
      return true;
    },
    [commitDefinition, currentDefinition, selectedEdgeIds, selectedNodeIds],
  );

  const selectNodeForIssue = useCallback(
    (nodeId: string): void => {
      window.requestAnimationFrame(() => {
        // 按实际节点边界定位，保留原来的缩放和动画时长，避免重复计算固定尺寸的中心。
        void flowInstance.current?.fitView({
          nodes: [{ id: nodeId }],
          minZoom: 1.1,
          maxZoom: 1.1,
          duration: 250,
        });
      });
      selectOnly([nodeId], []);
      focusSettingsAfterSelect.current = true;
    },
    [selectOnly],
  );

  const startDrag = useCallback((): void => {
    setDragging(true);
  }, []);

  // 拖动期间暂停自动保存；落点已由 onNodesChange 的位置变化记入历史。
  const finishDrag = useCallback((): void => {
    setDragging(false);
  }, []);

  return {
    nodes,
    edges,
    layoutDirection,
    selectedNode,
    selectedEdge,
    selectedNodeIds,
    selectedEdgeIds,
    canvasErrors,
    dragging,
    currentDefinition,
    parsedDefinition,
    issues,
    warnings,
    canvasElement,
    flowInstance,
    nodeSettingsHeading,
    hasClipboard,
    canUndo,
    canRedo,
    resetDefinition,
    undo,
    redo,
    copySelection,
    pasteSelection,
    onNodesChange,
    onEdgesChange,
    onSelectionChange,
    updateNode,
    addNode,
    canQuickAddFrom,
    addConnectedNode,
    handleConnect,
    changeLayoutDirection,
    autoArrange,
    deleteSelected,
    selectNodeForIssue,
    startDrag,
    finishDrag,
    clearErrors: () => setCanvasErrors([]),
  };
}
