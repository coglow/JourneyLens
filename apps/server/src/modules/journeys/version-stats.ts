import {
  executionStepOutputSchema,
  type ExecutionStepStatus,
  type JourneyDraftNode,
  type JourneyVersionNodeStats,
} from '@journeylens/shared';

/** 统计只读取定位节点与结果所需的步骤字段。 */
export interface VersionStatsStep {
  nodeId: string;
  status: ExecutionStepStatus;
  output: unknown;
}

type NodeCounters = {
  entered: number;
  completed: number;
  waiting: number;
  failed: number;
  stopped: number;
  met: number;
  unmet: number;
  matched: number;
  timeout: number;
};

function createCounters(): NodeCounters {
  return {
    entered: 0,
    completed: 0,
    waiting: 0,
    failed: 0,
    stopped: 0,
    met: 0,
    unmet: 0,
    matched: 0,
    timeout: 0,
  };
}

/**
 * 按版本快照的节点顺序汇总步骤记录。
 *
 * 每执行每节点最多一条步骤（数据库唯一约束 + 发布时禁止流程成环），因此“进入次数”等于该节点的步骤数。
 * 分支计数只取已完成步骤：条件节点在判断完成时写入 branch，等待行为节点在等到行为或超时后写入 outcome，
 * 等待中的步骤还没有结果。输出无法按当前契约解析时仍计入状态计数，只是不参与分支计数。
 */
export function aggregateNodeStats(
  nodes: readonly Pick<JourneyDraftNode, 'id' | 'name' | 'type'>[],
  steps: readonly VersionStatsStep[],
): JourneyVersionNodeStats[] {
  const countersByNodeId = new Map<string, NodeCounters>();

  for (const step of steps) {
    const counters = countersByNodeId.get(step.nodeId) ?? createCounters();
    countersByNodeId.set(step.nodeId, counters);
    counters.entered += 1;

    if (step.status === 'succeeded') counters.completed += 1;
    else if (step.status === 'waiting') counters.waiting += 1;
    else if (step.status === 'failed') counters.failed += 1;
    else counters.stopped += 1;

    if (step.status !== 'succeeded') continue;
    const output = executionStepOutputSchema.safeParse(step.output);
    if (!output.success) continue;
    if (output.data.kind === 'condition') {
      if (output.data.branch === 'met') counters.met += 1;
      else counters.unmet += 1;
    }
    if (output.data.kind === 'wait_for_event' && output.data.outcome !== null) {
      if (output.data.outcome === 'matched') counters.matched += 1;
      else counters.timeout += 1;
    }
  }

  // 按快照顺序列出全部节点：没有被任何执行到达的节点补 0 值行。
  return nodes.map((node) => {
    const counters = countersByNodeId.get(node.id) ?? createCounters();
    return {
      nodeId: node.id,
      name: node.name,
      nodeType: node.type,
      entered: counters.entered,
      completed: counters.completed,
      waiting: counters.waiting,
      failed: counters.failed,
      stopped: counters.stopped,
      conditionBranch:
        node.type === 'condition' ? { met: counters.met, unmet: counters.unmet } : null,
      waitOutcome:
        node.type === 'wait_for_event'
          ? { matched: counters.matched, timeout: counters.timeout }
          : null,
    };
  });
}
