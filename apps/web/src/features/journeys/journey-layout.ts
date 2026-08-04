import dagre from '@dagrejs/dagre';
import {
  JOURNEY_COORDINATE_LIMIT,
  type JourneyDraftEdge,
  type JourneyDraftNode,
  type JourneyLayoutDirection,
} from '@journeylens/shared';
import { NODE_HEIGHT, NODE_WIDTH } from './journey-canvas';

const NODE_SPACING = 120;
const RANK_SPACING = 100;

type Point = { x: number; y: number };

function shiftNodesToBranchSide(
  nodeIds: Set<string>,
  positions: Map<string, Point>,
  axis: 'x' | 'y',
  conditionCenter: number,
  nodeSize: number,
  side: 'before' | 'after',
): void {
  if (nodeIds.size === 0) return;
  const centers = [...nodeIds].map((id) => positions.get(id)![axis]);
  const halfNodeSize = nodeSize / 2;
  const outerEdge =
    side === 'before' ? Math.max(...centers) + halfNodeSize : Math.min(...centers) - halfNodeSize;
  const targetEdge =
    conditionCenter + (side === 'before' ? -1 : 1) * (halfNodeSize + NODE_SPACING / 2);
  const offset = targetEdge - outerEdge;
  for (const id of nodeIds) {
    positions.get(id)![axis] += offset;
  }
}

/**
 * 只计算节点坐标；双分支的独占后代固定到各自一侧，普通连线保留给 React Flow 绘制。
 * 编辑器、版本页和 AI 候选预览共用这一份尺寸与排列，保证预览看到的排布就是应用后的排布。
 */
export function layoutJourneyNodes(
  nodes: readonly JourneyDraftNode[],
  edges: readonly JourneyDraftEdge[],
  direction: JourneyLayoutDirection,
): Record<string, Point> {
  if (nodes.length === 0) return {};

  const graph = new dagre.graphlib.Graph()
    .setGraph({
      rankdir: direction === 'vertical' ? 'TB' : 'LR',
      nodesep: NODE_SPACING,
      ranksep: RANK_SPACING,
      marginx: 80,
      marginy: 80,
    })
    .setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);

  const positions = new Map<string, Point>();
  for (const node of nodes) {
    const laidOut = graph.node(node.id);
    positions.set(node.id, { x: laidOut.x!, y: laidOut.y! });
  }

  const crossAxis = direction === 'vertical' ? 'x' : 'y';
  const rankAxis = direction === 'vertical' ? 'y' : 'x';
  const crossAxisNodeSize = direction === 'vertical' ? NODE_WIDTH : NODE_HEIGHT;
  const conditions = nodes
    .filter((node) => node.type === 'condition' || node.type === 'wait_for_event')
    // 先排内层分支，再整体移动外层子树，避免外层调整让内层末端重新重叠。
    .sort((a, b) => positions.get(b.id)![rankAxis] - positions.get(a.id)![rankAxis]);

  for (const condition of conditions) {
    const firstBranch = condition.type === 'condition' ? 'met' : 'matched';
    const secondBranch = condition.type === 'condition' ? 'unmet' : 'timeout';
    const firstTarget = edges.find(
      (edge) => edge.source === condition.id && edge.branch === firstBranch,
    )?.target;
    const secondTarget = edges.find(
      (edge) => edge.source === condition.id && edge.branch === secondBranch,
    )?.target;
    if (firstTarget === undefined || secondTarget === undefined) continue;

    // 复用当前有向图的遍历，集合包含分支起点；两边共有的后代作为汇合节点保留原位置。
    const firstReachable = new Set(dagre.graphlib.alg.preorder(graph, firstTarget));
    const secondReachable = new Set(dagre.graphlib.alg.preorder(graph, secondTarget));
    const firstOnly = new Set([...firstReachable].filter((id) => !secondReachable.has(id)));
    const secondOnly = new Set([...secondReachable].filter((id) => !firstReachable.has(id)));
    const conditionPosition = positions.get(condition.id)!;
    // 用整组分支的边缘定位，确保内层节点仍留在外层分支的同一侧。
    shiftNodesToBranchSide(
      firstOnly,
      positions,
      crossAxis,
      conditionPosition[crossAxis],
      crossAxisNodeSize,
      'before',
    );
    shiftNodesToBranchSide(
      secondOnly,
      positions,
      crossAxis,
      conditionPosition[crossAxis],
      crossAxisNodeSize,
      'after',
    );
  }

  return Object.fromEntries(
    [...positions].map(([id, position]) => [
      id,
      {
        x: Math.max(
          -JOURNEY_COORDINATE_LIMIT,
          Math.min(JOURNEY_COORDINATE_LIMIT, Math.round(position.x - NODE_WIDTH / 2)),
        ),
        y: Math.max(
          -JOURNEY_COORDINATE_LIMIT,
          Math.min(JOURNEY_COORDINATE_LIMIT, Math.round(position.y - NODE_HEIGHT / 2)),
        ),
      },
    ]),
  );
}
