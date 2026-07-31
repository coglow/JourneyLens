import type { Prisma, PrismaClient } from '@prisma/client';
import { executionEntryEvidenceSchema } from '@journeylens/shared';
import type {
  AudienceFieldKey,
  ExecutionListItem,
  ExecutionListQuery,
  ExecutionStepOutput,
  ExecutionTrace,
  ExecutionTraceStep,
  JourneyVersionSnapshot,
  SegmentRule,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import { readSegmentRuleValue, type SegmentAudienceInput } from '../segments/rule-evaluator.js';

const executionListSelect = {
  id: true,
  status: true,
  currentNodeId: true,
  failureReason: true,
  createdAt: true,
  startedAt: true,
  endedAt: true,
  audienceUser: { select: { externalId: true, displayName: true } },
  campaign: { select: { id: true, name: true } },
  journey: { select: { id: true, name: true } },
  journeyVersion: { select: { id: true, versionNumber: true, snapshot: true } },
} as const;

const executionTraceSelect = {
  id: true,
  status: true,
  currentNodeId: true,
  failureReason: true,
  createdAt: true,
  startedAt: true,
  endedAt: true,
  audienceUser: {
    select: { externalId: true, displayName: true },
  },
  campaign: { select: { id: true, name: true, status: true } },
  journey: { select: { id: true, name: true } },
  journeyVersion: {
    select: { id: true, versionNumber: true, publishedAt: true, snapshot: true },
  },
  triggerEvent: {
    select: {
      id: true,
      type: true,
      receivedAt: true,
      payload: true,
      audienceSnapshot: true,
    },
  },
  steps: {
    orderBy: { order: 'asc' },
    select: {
      order: true,
      nodeId: true,
      nodeType: true,
      status: true,
      output: true,
      failureReason: true,
      startedAt: true,
      endedAt: true,
      deadlineAt: true,
      matchedEventId: true,
    },
  },
} as const;

type ExecutionListRecord = Prisma.ExecutionGetPayload<{ select: typeof executionListSelect }>;
type ExecutionTraceRecord = Prisma.ExecutionGetPayload<{ select: typeof executionTraceSelect }>;

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** 时间范围两端都可缺省，展开后不会留下多余条件。 */
function dateRangeFilter(from?: string, to?: string) {
  return {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(to) } : {}),
  };
}

function snapshotOf(record: { snapshot: Prisma.JsonValue }): JourneyVersionSnapshot {
  return record.snapshot as unknown as JourneyVersionSnapshot;
}

function resolveNode(snapshot: JourneyVersionSnapshot, nodeId: string | null) {
  if (nodeId === null) return undefined;
  return snapshot.definition.nodes.find((node) => node.id === nodeId);
}

function terminalResult(
  status: ExecutionListRecord['status'],
  snapshot: JourneyVersionSnapshot,
  currentNodeId: string | null,
  failureReason: string | null,
): string | null {
  if (status === 'completed') {
    const node = resolveNode(snapshot, currentNodeId);
    if (node?.type === 'end' && node.note !== null) return node.note.slice(0, 600);
    return '已到达结束步骤';
  }
  if (status === 'failed') return (failureReason ?? '执行失败').slice(0, 600);
  if (status === 'stopped') return '活动已停止，执行终止';
  return null;
}

function serializeListItem(record: ExecutionListRecord): ExecutionListItem {
  const snapshot = snapshotOf(record.journeyVersion);
  const node = resolveNode(snapshot, record.currentNodeId);
  const active = record.status === 'running' || record.status === 'waiting';

  return {
    id: record.id,
    audience: record.audienceUser,
    campaign: record.campaign,
    journey: record.journey,
    version: {
      id: record.journeyVersion.id,
      versionNumber: record.journeyVersion.versionNumber,
    },
    status: record.status,
    currentStep:
      active && node !== undefined
        ? { nodeId: node.id, name: node.name, nodeType: node.type }
        : null,
    result: active
      ? null
      : terminalResult(record.status, snapshot, record.currentNodeId, record.failureReason),
    createdAt: record.createdAt.toISOString(),
    startedAt: record.startedAt.toISOString(),
    endedAt: record.endedAt?.toISOString() ?? null,
  };
}

function serializeStep(
  record: ExecutionTraceRecord['steps'][number],
  snapshot: JourneyVersionSnapshot,
): ExecutionTraceStep {
  const node = resolveNode(snapshot, record.nodeId);
  return {
    order: record.order,
    nodeId: record.nodeId,
    nodeName: node?.name ?? record.nodeId,
    nodeType: record.nodeType,
    status: record.status,
    startedAt: record.startedAt.toISOString(),
    endedAt: record.endedAt?.toISOString() ?? null,
    deadlineAt: record.deadlineAt?.toISOString() ?? null,
    matchedEventId: record.matchedEventId,
    failureReason: record.failureReason,
    output: record.output as unknown as ExecutionStepOutput,
  };
}

/** 只提取发布时入口规则引用的字段，值来自进入时资料，不读取当前画像重新判断。 */
function entryEvidence(snapshot: JourneyVersionSnapshot, audienceSnapshot: Prisma.JsonValue) {
  const segment = snapshot.entrySegment;
  if (segment === null) return { segment: null, values: [] };

  const fields = new Set<AudienceFieldKey>();
  function collect(rule: SegmentRule): void {
    if (rule.kind === 'compare') fields.add(rule.left.path);
    else if (rule.kind === 'not') collect(rule.child);
    else rule.children.forEach(collect);
  }
  collect(segment.rules);
  const audience = audienceSnapshot as unknown as SegmentAudienceInput;

  return executionEntryEvidenceSchema.parse({
    segment: { name: segment.name, rules: segment.rules },
    values: [...fields].map((field) => {
      const value = readSegmentRuleValue(audience, field);
      return {
        field,
        actual: value === undefined ? { exists: false } : { exists: true, value },
      };
    }),
  });
}

function serializeTrace(record: ExecutionTraceRecord): ExecutionTrace {
  const snapshot = snapshotOf(record.journeyVersion);
  const node = resolveNode(snapshot, record.currentNodeId);

  return {
    id: record.id,
    status: record.status,
    currentNode:
      node === undefined ? null : { nodeId: node.id, name: node.name, nodeType: node.type },
    failureReason: record.failureReason,
    createdAt: record.createdAt.toISOString(),
    startedAt: record.startedAt.toISOString(),
    endedAt: record.endedAt?.toISOString() ?? null,
    campaign: record.campaign,
    journey: record.journey,
    version: {
      id: record.journeyVersion.id,
      versionNumber: record.journeyVersion.versionNumber,
      publishedAt: record.journeyVersion.publishedAt.toISOString(),
    },
    audience: record.audienceUser,
    entryEvidence: entryEvidence(snapshot, record.triggerEvent.audienceSnapshot),
    triggerEvent: {
      id: record.triggerEvent.id,
      type: record.triggerEvent.type,
      receivedAt: record.triggerEvent.receivedAt.toISOString(),
      payload: record.triggerEvent.payload as unknown as ExecutionTrace['triggerEvent']['payload'],
    },
    steps: record.steps.map((step) => serializeStep(step, snapshot)),
  };
}

/** 执行记录查询与轨迹读取；只展示数据库实际保存的运行事实。 */
export class ExecutionService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(input: ExecutionListQuery) {
    const keyword = input.q === undefined ? undefined : escapeLikePattern(input.q);
    const filters: Prisma.ExecutionWhereInput = {
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      ...(input.journeyId ? { journeyId: input.journeyId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(keyword
        ? {
            audienceUser: {
              OR: [
                { displayName: { contains: keyword, mode: 'insensitive' } },
                { externalId: { contains: keyword, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
      ...(input.createdFrom || input.createdTo
        ? { createdAt: dateRangeFilter(input.createdFrom, input.createdTo) }
        : {}),
      // 结束时间范围只匹配已经结束的执行，进行中与等待中没有结束时刻。
      ...(input.endedFrom || input.endedTo
        ? { endedAt: { not: null, ...dateRangeFilter(input.endedFrom, input.endedTo) } }
        : {}),
    };

    const total = await this.prisma.execution.count({ where: filters });
    const lastPage = Math.max(1, Math.ceil(total / input.pageSize));
    const page = Math.min(input.page, lastPage);
    const records = await this.prisma.execution.findMany({
      where: filters,
      skip: (page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: executionListSelect,
    });

    return {
      data: records.map(serializeListItem),
      page: { page, pageSize: input.pageSize, total },
    };
  }

  async getTrace(id: string): Promise<ExecutionTrace> {
    const record = await this.prisma.execution.findUnique({
      where: { id },
      select: executionTraceSelect,
    });
    if (record === null) {
      throw new ApiError(404, 'NOT_FOUND', '执行记录不存在');
    }
    return serializeTrace(record);
  }
}
