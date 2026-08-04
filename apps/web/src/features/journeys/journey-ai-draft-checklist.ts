import {
  JOURNEY_BRANCH_LABELS,
  type JourneyBranch,
  type JourneyDraftDefinition,
  type JourneyDraftEdge,
  type JourneyDraftNode,
} from '@journeylens/shared';

export type AiDraftNextStep = {
  /** 分支名：满足／不满足、等到行为／超时；普通下一步没有分支名。 */
  label: string;
  targetName: string;
};

export type AiDraftChecklistEntry = {
  node: JourneyDraftNode;
  /** 从开始步骤出发的到达顺序，从 1 开始。 */
  order: number;
  next: AiDraftNextStep[];
};

// 双分支步骤固定“满足／等到行为”在前，与画布上的连接点顺序一致。
const BRANCH_RANK: Record<JourneyBranch, number> = {
  met: 0,
  matched: 0,
  unmet: 1,
  timeout: 1,
};

function branchRank(branch: JourneyBranch | undefined): number {
  return branch === undefined ? 0 : BRANCH_RANK[branch];
}

function orderedEdges(edges: readonly JourneyDraftEdge[]): JourneyDraftEdge[] {
  return [...edges].sort((left, right) => branchRank(left.branch) - branchRank(right.branch));
}

/**
 * 关键设置清单的顺序：从开始步骤广度优先展开，分支先满足后不满足；
 * 汇合到同一步骤的路径只展开一次，没有被连到的步骤排在最后，便于发现遗漏。
 */
export function buildAiDraftChecklist(definition: JourneyDraftDefinition): AiDraftChecklistEntry[] {
  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, JourneyDraftEdge[]>();
  for (const edge of definition.edges) {
    const edges = outgoing.get(edge.source);
    if (edges === undefined) outgoing.set(edge.source, [edge]);
    else edges.push(edge);
  }

  const start = definition.nodes.find((node) => node.type === 'start');
  const ordered: JourneyDraftNode[] = [];
  const visited = new Set<string>();
  const queue = start === undefined ? [] : [start.id];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    const node = nodesById.get(nodeId);
    if (node === undefined) continue;
    visited.add(nodeId);
    ordered.push(node);
    for (const edge of orderedEdges(outgoing.get(nodeId) ?? [])) {
      if (!visited.has(edge.target)) queue.push(edge.target);
    }
  }

  for (const node of definition.nodes) {
    if (!visited.has(node.id)) ordered.push(node);
  }

  return ordered.map((node, index) => ({
    node,
    order: index + 1,
    next: orderedEdges(outgoing.get(node.id) ?? []).map((edge) => ({
      label: edge.branch === undefined ? '下一步' : JOURNEY_BRANCH_LABELS[edge.branch],
      targetName: nodesById.get(edge.target)?.name ?? '未知步骤',
    })),
  }));
}
