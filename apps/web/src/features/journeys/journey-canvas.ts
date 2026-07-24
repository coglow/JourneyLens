import {
  AUDIENCE_FIELDS,
  CONDITION_BRANCH_LABELS,
  JOURNEY_COORDINATE_LIMIT,
  JOURNEY_EDGE_LIMIT,
  JOURNEY_ENTRY_BEHAVIORS,
  JOURNEY_MESSAGE_CHANNELS,
  JOURNEY_NODE_LIMIT,
  getJourneyDraftGraphIssues,
  type ConditionBranch,
  type JourneyDraftDefinition,
  type JourneyDraftEdge,
  type JourneyDraftNode,
  type JourneyLayoutDirection,
  type JourneyNodeType,
} from '@journeylens/shared';
import { type Connection, type Edge } from '@xyflow/react';
import type { JourneyCanvasFlowNode } from '@/features/journeys/components/JourneyCanvasNode';

export const EMPTY_DEFINITION: JourneyDraftDefinition = {
  layoutDirection: 'vertical',
  nodes: [],
  edges: [],
};
export const NODE_WIDTH = 236;
export const NODE_HEIGHT = 104;
const NODE_GAP = 32;
const NODE_CLEARANCE = 16;
const PASTE_OFFSET = 40;
const MAX_POSITION_SEARCH_RING = JOURNEY_NODE_LIMIT + JOURNEY_EDGE_LIMIT;

export type DraftIssue = {
  message: string;
  nodeId?: string;
  /** 出错字段在草稿里的位置，例如 ['nodes', 2, 'waitSeconds']；设置面板据此把错误送回对应输入框。 */
  path: readonly PropertyKey[];
  key: string;
};
type Point = { x: number; y: number };
type Rect = { left: number; top: number; right: number; bottom: number };
export type OpenPositionResult = { status: 'found'; position: Point } | { status: 'not-found' };

/** 草稿保存业务字段，画布额外携带连接点、标签和选中状态。 */
export function toFlowNode(
  node: JourneyDraftNode,
  layoutDirection: JourneyLayoutDirection,
): JourneyCanvasFlowNode {
  return {
    id: node.id,
    type: 'journey',
    position: node.position,
    data: { draftNode: node, layoutDirection },
  };
}

export function toFlowEdge(edge: JourneyDraftEdge): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.branch ?? 'next',
    targetHandle: 'target',
    type: 'smoothstep',
    ...(edge.branch
      ? {
          label: CONDITION_BRANCH_LABELS[edge.branch],
          labelStyle: { fontSize: 12, fontWeight: 600 },
          labelBgStyle: { fill: '#fff', fillOpacity: 0.98 },
          labelBgPadding: [4, 3],
          labelBgBorderRadius: 4,
        }
      : {}),
  };
}

/** 只保留连线的业务字段；条件分支的连接点标识转回分支取值。 */
export function toDraftEdge(edge: Edge): JourneyDraftEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle === 'met' || edge.sourceHandle === 'unmet'
      ? { branch: edge.sourceHandle }
      : {}),
  };
}

export function newDraftEdge(
  source: string,
  target: string,
  branch?: ConditionBranch,
): JourneyDraftEdge {
  return {
    id: crypto.randomUUID(),
    source,
    target,
    ...(branch === undefined ? {} : { branch }),
  };
}

/** 保存时剔除画布展示字段；节点标识与坐标以画布为准。 */
export function toDefinition(
  nodes: readonly JourneyCanvasFlowNode[],
  edges: readonly Edge[],
  layoutDirection: JourneyLayoutDirection,
): JourneyDraftDefinition {
  return {
    layoutDirection,
    nodes: nodes.map((node) => ({
      ...node.data.draftNode,
      id: node.id,
      position: node.position,
    })),
    edges: edges.map(toDraftEdge),
  };
}

export function toCanvasDefinition(definition: JourneyDraftDefinition) {
  return {
    nodes: definition.nodes.map((node) => toFlowNode(node, definition.layoutDirection)),
    edges: definition.edges.map(toFlowEdge),
  };
}

/** 撤销历史只记录画布结构和坐标；节点配置由画布单独保留最新值。 */
export type CanvasSnapshot = {
  layoutDirection: JourneyLayoutDirection;
  nodes: Array<{ id: string; position: Point }>;
  edges: JourneyDraftEdge[];
};

export function toCanvasSnapshot(definition: JourneyDraftDefinition): CanvasSnapshot {
  return {
    layoutDirection: definition.layoutDirection,
    nodes: definition.nodes.map((node) => ({ id: node.id, position: { ...node.position } })),
    edges: definition.edges.map((edge) => ({ ...edge })),
  };
}

/**
 * 从给定中心向外按环形尝试，返回第一个不与已有节点重叠的位置。
 * 画布上的连线允许从新节点下方经过，需要时由用户自己拖动调整。
 */
export function findOpenPosition(
  center: Point,
  nodes: readonly JourneyCanvasFlowNode[],
): OpenPositionResult {
  const start = { x: center.x - NODE_WIDTH / 2, y: center.y - NODE_HEIGHT / 2 };
  // 卡片尺寸由本模块统一给出，这里只需要读取画布测量到的实际大小。
  const occupied = nodes.map((node) => ({
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + (node.measured?.width ?? NODE_WIDTH),
    bottom: node.position.y + (node.measured?.height ?? NODE_HEIGHT),
  }));

  for (let ring = 0; ring <= MAX_POSITION_SEARCH_RING; ring += 1) {
    for (let row = -ring; row <= ring; row += 1) {
      for (let column = -ring; column <= ring; column += 1) {
        if (Math.max(Math.abs(row), Math.abs(column)) !== ring) continue;
        const position = {
          x: start.x + column * (NODE_WIDTH + NODE_GAP),
          y: start.y + row * (NODE_HEIGHT + NODE_GAP),
        };
        if (
          Math.abs(position.x) > JOURNEY_COORDINATE_LIMIT ||
          Math.abs(position.y) > JOURNEY_COORDINATE_LIMIT
        ) {
          continue;
        }
        const candidate = {
          left: position.x,
          top: position.y,
          right: position.x + NODE_WIDTH,
          bottom: position.y + NODE_HEIGHT,
        };
        if (occupied.some((bounds) => rectanglesOverlap(candidate, bounds, NODE_CLEARANCE))) {
          continue;
        }
        return { status: 'found', position };
      }
    }
  }

  return { status: 'not-found' };
}

function rectanglesOverlap(first: Rect, second: Rect, clearance: number): boolean {
  return (
    first.left < second.right + clearance &&
    first.right > second.left - clearance &&
    first.top < second.bottom + clearance &&
    first.bottom > second.top - clearance
  );
}

export function newDraftNode(type: JourneyNodeType, position: Point): JourneyDraftNode {
  const id = crypto.randomUUID();
  switch (type) {
    case 'start':
      return {
        id,
        type,
        name: '开始',
        position,
        entryBehavior: JOURNEY_ENTRY_BEHAVIORS[0]!.value,
      };
    case 'condition': {
      // 旅程条件只有一条比较判断，新节点先给出属性和比较方式，比较值待用户填写。
      const field = AUDIENCE_FIELDS[0]!;
      return {
        id,
        type,
        name: '条件分支',
        position,
        rules: {
          kind: 'compare',
          left: { source: 'user', path: field.key },
          operator: field.operators[0]!,
        },
      };
    }
    case 'wait':
      return { id, type, name: '定时等待', position, waitSeconds: 3_600 };
    case 'message':
      return {
        id,
        type,
        name: '消息',
        position,
        channel: JOURNEY_MESSAGE_CHANNELS[0]!.value,
        subject: null,
        body: '',
      };
    case 'end':
      return { id, type, name: '结束', position, note: null };
  }
}

export type JourneyClipboard = { nodes: JourneyDraftNode[]; edges: JourneyDraftEdge[] };

export type PasteResult =
  | { status: 'pasted'; definition: JourneyDraftDefinition; nodeIds: string[] }
  | { status: 'error'; message: string };

/**
 * 把复制内容粘进当前草稿：重建节点与连线标识、逐次错开位置，
 * 只检查数量上限、开始节点和图结构，允许配置尚未填完的节点一起粘贴。
 */
export function pasteClipboard(
  definition: JourneyDraftDefinition,
  clipboard: JourneyClipboard,
  pasteCount: number,
): PasteResult {
  if (definition.nodes.length + clipboard.nodes.length > JOURNEY_NODE_LIMIT) {
    return { status: 'error', message: `最多添加 ${JOURNEY_NODE_LIMIT} 个节点。` };
  }
  if (definition.edges.length + clipboard.edges.length > JOURNEY_EDGE_LIMIT) {
    return { status: 'error', message: `最多添加 ${JOURNEY_EDGE_LIMIT} 条连线。` };
  }
  if (
    clipboard.nodes.some((node) => node.type === 'start') &&
    definition.nodes.some((node) => node.type === 'start')
  ) {
    return { status: 'error', message: '一条旅程只能有一个开始节点，当前内容无法粘贴。' };
  }

  const offset = PASTE_OFFSET * (pasteCount + 1);
  const idMap = new Map(clipboard.nodes.map((node) => [node.id, crypto.randomUUID()]));
  const pastedNodes = clipboard.nodes.map((node) => ({
    ...structuredClone(node),
    id: idMap.get(node.id)!,
    position: { x: node.position.x + offset, y: node.position.y + offset },
  }));
  const next: JourneyDraftDefinition = {
    layoutDirection: definition.layoutDirection,
    nodes: [...definition.nodes, ...pastedNodes],
    edges: [
      ...definition.edges,
      ...clipboard.edges.map((edge) => ({
        id: crypto.randomUUID(),
        source: idMap.get(edge.source)!,
        target: idMap.get(edge.target)!,
        ...(edge.branch === undefined ? {} : { branch: edge.branch }),
      })),
    ],
  };

  const graphIssue = getJourneyDraftGraphIssues(next.nodes, next.edges)[0];
  if (graphIssue !== undefined) return { status: 'error', message: graphIssue.message };
  if (
    pastedNodes.some(
      ({ position }) =>
        Math.abs(position.x) > JOURNEY_COORDINATE_LIMIT ||
        Math.abs(position.y) > JOURNEY_COORDINATE_LIMIT,
    )
  ) {
    return { status: 'error', message: '粘贴后的步骤位置超出可编辑范围。' };
  }

  return { status: 'pasted', definition: next, nodeIds: pastedNodes.map((node) => node.id) };
}

/**
 * 从该节点能否再连出下一步。
 * 用一个不会被提交的占位节点复用共享的图结构校验，避免界面另写一套连接规则。
 */
export function getNextStepIssue(
  definition: JourneyDraftDefinition,
  sourceId: string,
  branch?: ConditionBranch,
): string | undefined {
  if (definition.nodes.length >= JOURNEY_NODE_LIMIT) {
    return `最多添加 ${JOURNEY_NODE_LIMIT} 个节点。`;
  }
  if (definition.edges.length >= JOURNEY_EDGE_LIMIT) {
    return `最多添加 ${JOURNEY_EDGE_LIMIT} 条连线。`;
  }

  const probeId = crypto.randomUUID();
  return getJourneyDraftGraphIssues(
    [...definition.nodes, { id: probeId, type: 'wait' }],
    [...definition.edges, newDraftEdge(sourceId, probeId, branch)],
  )[0]?.message;
}

export function isConnectionReady(
  connection: Pick<Connection, 'source' | 'target'>,
): connection is Connection & { source: string; target: string } {
  return connection.source !== null && connection.target !== null;
}
