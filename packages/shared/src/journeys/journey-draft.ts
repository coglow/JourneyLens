import { z } from 'zod';
import { segmentCompareRuleSchema } from '../segments/segment-rule.js';

export const JOURNEY_NODE_LIMIT = 30;
export const JOURNEY_EDGE_LIMIT = 60;
export const JOURNEY_NODE_NAME_MAX_LENGTH = 120;
export const JOURNEY_END_NOTE_MAX_LENGTH = 500;
export const JOURNEY_MESSAGE_BODY_MAX_LENGTH = 2_000;
export const JOURNEY_MESSAGE_SUBJECT_MAX_LENGTH = 200;
/** 等待时长统一按秒保存，30 天覆盖按天跟进的场景。 */
export const JOURNEY_WAIT_MAX_SECONDS = 30 * 24 * 60 * 60;
export const JOURNEY_COORDINATE_LIMIT = 100_000;

const NODE_ID_MAX_LENGTH = 64;

/**
 * 开始节点可选的进入行为：本次只需要静态名称和标识，
 * 不建设行为目录管理，也不接收行为属性。
 */
export const JOURNEY_ENTRY_BEHAVIORS = [
  { value: 'product_viewed', label: '浏览商品' },
  { value: 'purchase_completed', label: '完成购买' },
  { value: 'reservation_created', label: '创建预约' },
  { value: 'app_session_started', label: '进入应用' },
  { value: 'app_exit', label: '退出应用' },
  { value: 'registration_completed', label: '完成注册' },
  { value: 'subscription_started', label: '开通订阅' },
] as const;

export type JourneyEntryBehavior = (typeof JOURNEY_ENTRY_BEHAVIORS)[number]['value'];

export const JOURNEY_ENTRY_BEHAVIOR_VALUES: readonly JourneyEntryBehavior[] =
  JOURNEY_ENTRY_BEHAVIORS.map((item) => item.value);

/** 消息渠道：只有邮件需要主题，短信和推送不保存主题。 */
export const JOURNEY_MESSAGE_CHANNELS = [
  { value: 'sms', label: '短信' },
  { value: 'push', label: '推送' },
  { value: 'email', label: '邮件' },
] as const;

export type JourneyMessageChannel = (typeof JOURNEY_MESSAGE_CHANNELS)[number]['value'];

export const JOURNEY_MESSAGE_CHANNEL_VALUES: readonly JourneyMessageChannel[] =
  JOURNEY_MESSAGE_CHANNELS.map((item) => item.value);

export const JOURNEY_NODE_TYPES = ['start', 'condition', 'wait', 'message', 'end'] as const;

export type JourneyNodeType = (typeof JOURNEY_NODE_TYPES)[number];

/** 条件节点固定两条路径：满足与不满足，保存时不根据连线顺序推断。 */
export const CONDITION_BRANCHES = ['met', 'unmet'] as const;

export type ConditionBranch = (typeof CONDITION_BRANCHES)[number];

export const CONDITION_BRANCH_LABELS: Record<ConditionBranch, string> = {
  met: '满足',
  unmet: '不满足',
};

const nodeIdSchema = z
  .string({ error: '节点标识不能为空' })
  .trim()
  .min(1, '节点标识不能为空')
  .max(NODE_ID_MAX_LENGTH, '节点标识过长');

const edgeIdSchema = z
  .string({ error: '连线标识不能为空' })
  .trim()
  .min(1, '连线标识不能为空')
  .max(NODE_ID_MAX_LENGTH, '连线标识过长');

const nodeNameSchema = z
  .string({ error: '节点名称不能为空' })
  .trim()
  .min(1, '节点名称不能为空')
  .max(JOURNEY_NODE_NAME_MAX_LENGTH, `节点名称最多 ${JOURNEY_NODE_NAME_MAX_LENGTH} 个字符`);

const coordinateSchema = z
  .number({ error: '节点位置必须是有效数值' })
  .min(-JOURNEY_COORDINATE_LIMIT, '节点位置超出可编辑范围')
  .max(JOURNEY_COORDINATE_LIMIT, '节点位置超出可编辑范围');

const positionSchema = z.object({ x: coordinateSchema, y: coordinateSchema }).strict();

const startNodeSchema = z
  .object({
    id: nodeIdSchema,
    type: z.literal('start'),
    name: nodeNameSchema,
    position: positionSchema,
    entryBehavior: z.enum(JOURNEY_ENTRY_BEHAVIOR_VALUES, { error: '请选择有效的进入行为' }),
  })
  .strict();

const conditionNodeSchema = z
  .object({
    id: nodeIdSchema,
    type: z.literal('condition'),
    name: nodeNameSchema,
    position: positionSchema,
    // 旅程条件只保存一条比较判断，复用分群的属性、比较方式和比较值校验；
    // “全部满足／任一满足／排除组”等组合结构只属于分群。
    rules: segmentCompareRuleSchema,
  })
  .strict();

const waitNodeSchema = z
  .object({
    id: nodeIdSchema,
    type: z.literal('wait'),
    name: nodeNameSchema,
    position: positionSchema,
    waitSeconds: z
      .number({ error: '等待时长必须是整数秒' })
      .int('等待时长必须是整数秒')
      .min(1, '等待时长至少 1 秒')
      .max(JOURNEY_WAIT_MAX_SECONDS, '等待时长最多 30 天'),
  })
  .strict();

const messageNodeSchema = z
  .object({
    id: nodeIdSchema,
    type: z.literal('message'),
    name: nodeNameSchema,
    position: positionSchema,
    channel: z.enum(JOURNEY_MESSAGE_CHANNEL_VALUES, { error: '请选择消息渠道' }),
    // 非邮件渠道统一存 null，避免残留上一次填写的邮件主题。
    subject: z
      .string({ error: '请填写有效的邮件主题' })
      .trim()
      .max(JOURNEY_MESSAGE_SUBJECT_MAX_LENGTH, '邮件主题最多 200 个字符')
      .nullish()
      .transform((value) => value || null),
    body: z
      .string({ error: '请填写消息内容' })
      .trim()
      .min(1, '消息内容不能为空')
      .max(JOURNEY_MESSAGE_BODY_MAX_LENGTH, '消息内容最多 2000 个字符'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.channel === 'email') {
      if (value.subject === null) {
        ctx.addIssue({ code: 'custom', path: ['subject'], message: '请填写邮件主题' });
      }
      return;
    }
    if (value.subject !== null) {
      ctx.addIssue({ code: 'custom', path: ['subject'], message: '短信和推送不需要邮件主题' });
    }
  });

const endNodeSchema = z
  .object({
    id: nodeIdSchema,
    type: z.literal('end'),
    name: nodeNameSchema,
    position: positionSchema,
    note: z
      .string({ error: '结束说明最多 500 个字符' })
      .trim()
      .max(JOURNEY_END_NOTE_MAX_LENGTH, '结束说明最多 500 个字符')
      .nullish()
      .transform((value) => value || null),
  })
  .strict();

export const journeyDraftNodeSchema = z.discriminatedUnion('type', [
  startNodeSchema,
  conditionNodeSchema,
  waitNodeSchema,
  messageNodeSchema,
  endNodeSchema,
]);

export const journeyDraftEdgeSchema = z
  .object({
    id: edgeIdSchema,
    source: nodeIdSchema,
    target: nodeIdSchema,
    branch: z.enum(CONDITION_BRANCHES, { error: '分支标记无效' }).optional(),
  })
  .strict();

export type JourneyDraftNode = z.infer<typeof journeyDraftNodeSchema>;
export type JourneyDraftEdge = z.infer<typeof journeyDraftEdgeSchema>;

export const JOURNEY_LAYOUT_DIRECTIONS = ['vertical', 'horizontal'] as const;
export type JourneyLayoutDirection = (typeof JOURNEY_LAYOUT_DIRECTIONS)[number];

const journeyDraftShapeSchema = z
  .object({
    // 旧草稿缺少方向时按现有上下连接点恢复为纵向。
    layoutDirection: z.enum(JOURNEY_LAYOUT_DIRECTIONS).default('vertical'),
    nodes: z.array(journeyDraftNodeSchema),
    edges: z.array(journeyDraftEdgeSchema),
  })
  .strict();

type JourneyDraftShape = z.infer<typeof journeyDraftShapeSchema>;

export interface JourneyDraftGraphIssue {
  message: string;
  path: Array<string | number>;
}

function addDraftIssue(
  ctx: z.RefinementCtx,
  message: string,
  path: Array<string | number> = [],
): void {
  ctx.addIssue({ code: 'custom', message, path });
}

/** 图结构校验不读取节点配置，允许先连线再补正文、比较值等必填内容。 */
export function getJourneyDraftGraphIssues(
  nodes: readonly Pick<JourneyDraftNode, 'id' | 'type'>[],
  edges: readonly JourneyDraftEdge[],
): JourneyDraftGraphIssue[] {
  const issues: JourneyDraftGraphIssue[] = [];
  const addIssue = (message: string, path: Array<string | number> = []): void => {
    issues.push({ message, path });
  };

  if (nodes.length > JOURNEY_NODE_LIMIT) {
    addIssue(`一条旅程最多包含 ${JOURNEY_NODE_LIMIT} 个节点`, ['nodes']);
  }
  if (edges.length > JOURNEY_EDGE_LIMIT) {
    addIssue(`一条旅程最多包含 ${JOURNEY_EDGE_LIMIT} 条连线`, ['edges']);
  }
  if (nodes.length === 0) {
    addIssue('请至少添加一个节点再保存', ['nodes']);
    return issues;
  }

  const nodesById = new Map<string, Pick<JourneyDraftNode, 'id' | 'type'>>();
  const nodeIndexById = new Map<string, number>();
  nodes.forEach((node, index) => {
    if (nodesById.has(node.id)) {
      addIssue('节点标识重复，请检查后重试', ['nodes', index, 'id']);
      return;
    }
    nodesById.set(node.id, node);
    nodeIndexById.set(node.id, index);
  });

  if (nodes.filter((node) => node.type === 'start').length > 1) {
    addIssue('一条旅程只能有一个开始节点', ['nodes']);
  }

  const edgeIds = new Set<string>();
  const connectionKeys = new Set<string>();
  const outgoingCounts = new Map<string, { total: number; met: number; unmet: number }>();
  const outgoingTargets = new Map<string, string[]>();

  edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) {
      addIssue('连线标识重复，请检查后重试', ['edges', index, 'id']);
      return;
    }
    edgeIds.add(edge.id);

    const source = nodesById.get(edge.source);
    if (source === undefined) {
      addIssue('连线从已经删除的节点出发，请重新连接', ['edges', index, 'source']);
      return;
    }
    const target = nodesById.get(edge.target);
    if (target === undefined) {
      addIssue('连线指向了不存在的节点，请重新连接', ['edges', index, 'target']);
      return;
    }
    if (edge.source === edge.target) {
      addIssue('连线不能把节点连到自己', ['edges', index]);
      return;
    }
    if (target.type === 'start') {
      addIssue('连线不能指向开始节点', ['edges', index, 'target']);
      return;
    }
    if (source.type === 'end') {
      addIssue('结束节点后面不能再连接其他节点', ['edges', index, 'source']);
      return;
    }
    if (source.type === 'condition' && edge.branch === undefined) {
      addIssue('条件分支的连线需要标明“满足”或“不满足”', ['edges', index, 'branch']);
      return;
    }
    if (source.type !== 'condition' && edge.branch !== undefined) {
      addIssue('只有条件分支的连线才能标明“满足”或“不满足”', ['edges', index, 'branch']);
      return;
    }

    // 同一对起止节点、同一分支只允许一条线；条件节点两条分支允许汇合到同一节点。
    const connectionKey = `${edge.source}\u0000${edge.target}\u0000${edge.branch ?? ''}`;
    if (connectionKeys.has(connectionKey)) {
      addIssue('存在重复的连线，请删除多余的连线', ['edges', index]);
      return;
    }
    connectionKeys.add(connectionKey);

    const counts = outgoingCounts.get(edge.source) ?? { total: 0, met: 0, unmet: 0 };
    counts.total += 1;
    if (edge.branch === 'met') counts.met += 1;
    if (edge.branch === 'unmet') counts.unmet += 1;
    outgoingCounts.set(edge.source, counts);

    const targets = outgoingTargets.get(edge.source);
    if (targets === undefined) {
      outgoingTargets.set(edge.source, [edge.target]);
    } else {
      targets.push(edge.target);
    }
  });

  for (const [nodeId, counts] of outgoingCounts) {
    const index = nodeIndexById.get(nodeId);
    const node = nodesById.get(nodeId);
    if (index === undefined || node === undefined) continue;

    if (node.type === 'condition') {
      if (counts.met > 1) {
        addIssue('条件分支的“满足”路径只能连接一个下一步', ['nodes', index]);
      }
      if (counts.unmet > 1) {
        addIssue('条件分支的“不满足”路径只能连接一个下一步', ['nodes', index]);
      }
      continue;
    }
    // 结束节点没有出线；其余节点（开始、等待、消息）只允许一个下一步。
    if (counts.total > 1) {
      addIssue('一个节点只能连接一个下一步', ['nodes', index]);
    }
  }

  if (hasCycle(nodes, outgoingTargets)) {
    addIssue('连线形成了循环，请调整节点之间的连接', ['edges']);
  }

  return issues;
}

/** 深度优先染色：0 未访问、1 在当前路径上、2 已完成。回到路径上的节点即存在环路。 */
function hasCycle(
  nodes: readonly Pick<JourneyDraftNode, 'id' | 'type'>[],
  outgoingTargets: ReadonlyMap<string, readonly string[]>,
): boolean {
  const state = new Map<string, 0 | 1 | 2>();

  for (const node of nodes) {
    if (state.get(node.id) !== undefined) continue;

    const stack: Array<{ id: string; next: number }> = [{ id: node.id, next: 0 }];
    state.set(node.id, 1);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;

      const targets = outgoingTargets.get(frame.id) ?? [];
      const nextId = targets[frame.next];
      if (nextId === undefined) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      frame.next += 1;

      const nextState = state.get(nextId);
      if (nextState === 1) return true;
      if (nextState === undefined) {
        state.set(nextId, 1);
        stack.push({ id: nextId, next: 0 });
      }
    }
  }

  return false;
}

/** 保存时在完整节点配置校验之后应用同一套图结构规则。 */
function validateJourneyDraft(definition: JourneyDraftShape, ctx: z.RefinementCtx): void {
  for (const issue of getJourneyDraftGraphIssues(definition.nodes, definition.edges)) {
    addDraftIssue(ctx, issue.message, issue.path);
  }
}

export const journeyDraftDefinitionSchema =
  journeyDraftShapeSchema.superRefine(validateJourneyDraft);

export type JourneyDraftDefinition = z.infer<typeof journeyDraftDefinitionSchema>;

export type JourneyDraftWarningCode =
  'missing-end' | 'missing-next' | 'missing-branch' | 'unlinked-node';

export interface JourneyDraftWarning {
  code: JourneyDraftWarningCode;
  /** 出问题的节点，前端据此定位；空数组表示缺少整条旅程的结束节点。 */
  nodeIds: readonly string[];
  message: string;
}

/**
 * 草稿允许未完成的连接，这里把需要补齐的内容转成可定位提示。
 * 条件节点只有一条比较判断，不存在组合条件互相矛盾的问题，
 * 因此不复用分群的规则矛盾分析。
 */
export function getJourneyDraftWarnings(definition: {
  nodes: readonly Pick<JourneyDraftNode, 'id' | 'type' | 'name'>[];
  edges: readonly Pick<JourneyDraftEdge, 'source' | 'target' | 'branch'>[];
}): JourneyDraftWarning[] {
  const incomingCount = new Map<string, number>();
  const outgoingEdges = new Map<
    string,
    Array<Pick<JourneyDraftEdge, 'source' | 'target' | 'branch'>>
  >();
  for (const edge of definition.edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    const edges = outgoingEdges.get(edge.source);
    if (edges === undefined) {
      outgoingEdges.set(edge.source, [edge]);
    } else {
      edges.push(edge);
    }
  }

  const warnings: JourneyDraftWarning[] = [];
  for (const node of definition.nodes) {
    if (node.type !== 'start' && (incomingCount.get(node.id) ?? 0) === 0) {
      warnings.push({
        code: 'unlinked-node',
        nodeIds: [node.id],
        message: `「${node.name}」还没有连接到上一步。`,
      });
    }

    const edges = outgoingEdges.get(node.id) ?? [];
    if (node.type === 'start' || node.type === 'wait' || node.type === 'message') {
      if (edges.length === 0) {
        warnings.push({
          code: 'missing-next',
          nodeIds: [node.id],
          message: `「${node.name}」还没有连接下一步。`,
        });
      }
    }

    if (node.type === 'condition') {
      for (const branch of CONDITION_BRANCHES) {
        if (!edges.some((edge) => edge.branch === branch)) {
          warnings.push({
            code: 'missing-branch',
            nodeIds: [node.id],
            message: `「${node.name}」的“${CONDITION_BRANCH_LABELS[branch]}”路径还没有连接。`,
          });
        }
      }
    }
  }

  if (!definition.nodes.some((node) => node.type === 'end')) {
    warnings.push({ code: 'missing-end', nodeIds: [], message: '旅程还没有结束节点。' });
  }

  return warnings;
}
