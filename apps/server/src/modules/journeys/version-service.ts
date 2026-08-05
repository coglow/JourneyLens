import type { Prisma, PrismaClient } from '@prisma/client';
import {
  canEditCampaign,
  getJourneyDraftWarnings,
  journeyDraftDefinitionSchema,
  journeyEventHasProductId,
  journeyVersionSnapshotMetaSchema,
  type ExecutionStatus,
  type JourneyVersionDetail,
  type JourneyVersionListQuery,
  type JourneyVersionPublish,
  type JourneyVersionSnapshot,
  type JourneyVersionStats,
  type JourneyVersionSummary,
  type SegmentRule,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import { lockCampaignForJourneyWrite } from '../campaigns/campaign-lock.js';
import { aggregateNodeStats } from './version-stats.js';

const versionSummarySelect = {
  id: true,
  journeyId: true,
  versionNumber: true,
  sourceRevision: true,
  sourceSegmentRevision: true,
  publishedAt: true,
  publishedBy: { select: { id: true, displayName: true } },
} as const;

const versionDetailSelect = {
  ...versionSummarySelect,
  snapshot: true,
} as const;

type VersionSummaryRecord = Prisma.JourneyVersionGetPayload<{
  select: typeof versionSummarySelect;
}>;

type VersionDetailRecord = Prisma.JourneyVersionGetPayload<{ select: typeof versionDetailSelect }>;

function serializeSummary(record: VersionSummaryRecord): JourneyVersionSummary {
  return {
    id: record.id,
    journeyId: record.journeyId,
    versionNumber: record.versionNumber,
    sourceRevision: record.sourceRevision,
    sourceSegmentRevision: record.sourceSegmentRevision,
    publishedAt: record.publishedAt.toISOString(),
    publishedBy: record.publishedBy,
  };
}

function serializeDetail(record: VersionDetailRecord): JourneyVersionDetail {
  return {
    ...serializeSummary(record),
    snapshot: record.snapshot as JourneyVersionSnapshot,
  };
}

function journeyNotFound(): ApiError {
  return new ApiError(404, 'NOT_FOUND', '旅程不存在');
}

function versionNotFound(): ApiError {
  return new ApiError(404, 'NOT_FOUND', '版本不存在');
}

function revisionConflict(): ApiError {
  return new ApiError(409, 'JOURNEY_REVISION_CONFLICT', '旅程已在其他页面修改，请重新读取后再发布');
}

function segmentRevisionConflict(): ApiError {
  return new ApiError(
    409,
    'JOURNEY_SEGMENT_REVISION_CONFLICT',
    '入口分群已修改，请重新确认分群规则后再发布',
  );
}

type LockedSegment = {
  id: string;
  name: string;
  revision: number;
  rules: SegmentRule;
};

/**
 * 发布版本：把已保存的旅程内容与发布时的入口分群规则固定为一个版本。
 */
export class JourneyVersionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async publish(
    journeyId: string,
    input: JourneyVersionPublish,
    accountId: string,
  ): Promise<{ version: JourneyVersionDetail; created: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      // 活动标识不可变：先普通读取归属（不取得行锁），再按“活动 → 旅程 → 分群”的统一顺序加锁，
      // 与旅程写入、启停使用同一顺序，避免互相等待形成环。
      const located = await tx.journey.findUnique({
        where: { id: journeyId },
        select: { campaignId: true },
      });
      if (located === null) throw journeyNotFound();

      // 活动共享锁持有到提交，发布期间状态不会被暂停、恢复或停止改变。
      const campaignStatus = await lockCampaignForJourneyWrite(tx, located.campaignId);
      if (campaignStatus === null) {
        throw new ApiError(404, 'NOT_FOUND', '活动不存在');
      }

      // 锁住旅程行：同一旅程的发布请求依次处理，版本号分配和“同一依据只生成一版”都靠这把锁。
      const lockedJourney = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "journeys" WHERE "id" = ${journeyId}::uuid FOR UPDATE
      `;
      if (lockedJourney.length === 0) throw journeyNotFound();

      const journey = await tx.journey.findUnique({
        where: { id: journeyId },
        select: {
          campaignId: true,
          segmentId: true,
          name: true,
          description: true,
          revision: true,
          draftDefinition: true,
        },
      });
      if (journey === null) throw journeyNotFound();
      // 草稿与暂停都允许发布：暂停是维护窗口，修正内容需要生成新的固定版本。
      if (!canEditCampaign(campaignStatus)) {
        throw new ApiError(409, 'CAMPAIGN_NOT_EDITABLE', '只有草稿或已暂停的活动可以发布旅程');
      }

      if (journey.revision !== input.revision) throw revisionConflict();

      let segment: LockedSegment | null = null;
      if (journey.segmentId !== null) {
        const rows = await tx.$queryRaw<LockedSegment[]>`
          SELECT "id", "name", "revision", "rules"
          FROM "segments" WHERE "id" = ${journey.segmentId}::uuid FOR SHARE
        `;
        segment = rows[0] ?? null;
      }
      if (segment === null) {
        // 不限人群：请求必须显式表示没有分群依据；带分群修订号说明页面内容已经过期。
        if (input.segmentRevision !== null) throw segmentRevisionConflict();
      } else if (input.segmentRevision !== segment.revision) {
        throw segmentRevisionConflict();
      }

      // 同一发布依据已经生成过版本时直接返回原版本，重复点击和响应丢失后的重试都不会多出版本。
      const existing = await tx.journeyVersion.findFirst({
        where: {
          journeyId,
          sourceRevision: input.revision,
          sourceSegmentRevision: input.segmentRevision,
        },
        select: versionDetailSelect,
      });
      if (existing !== null) {
        return { version: serializeDetail(existing), created: false };
      }

      if (journey.draftDefinition === null) {
        throw new ApiError(409, 'JOURNEY_DRAFT_INCOMPLETE', '请先保存编排后再发布');
      }
      const definition = journeyDraftDefinitionSchema.safeParse(journey.draftDefinition);
      if (!definition.success) {
        throw new ApiError(
          409,
          'JOURNEY_DRAFT_INVALID',
          '该旅程已保存的内容无法用于发布，请重新保存编排',
        );
      }
      const warnings = getJourneyDraftWarnings(definition.data);
      if (warnings.length > 0) {
        // 商品变量来源问题要说明具体原因；其他未完成流程仍沿用原提示。
        const productWarning = warnings.find(
          (warning) => warning.code === 'message-product-unavailable',
        );
        throw new ApiError(
          409,
          'JOURNEY_DRAFT_INCOMPLETE',
          productWarning?.message ?? '请先补齐流程连接',
        );
      }

      // 每次实际生成发布版本前，在活动锁内确认目标与开始行为兼容：开启同商品时，
      // 开始行为必须带商品资料，否则该旅程的参与无法判断目标是否达成。
      const campaignGoal = await tx.campaign.findUnique({
        where: { id: located.campaignId },
        select: { goalEventType: true, goalSameProduct: true },
      });
      if (campaignGoal === null) throw new ApiError(404, 'NOT_FOUND', '活动不存在');
      const startNode = definition.data.nodes.find((node) => node.type === 'start');
      if (
        campaignGoal.goalEventType !== null &&
        campaignGoal.goalSameProduct &&
        startNode !== undefined &&
        !journeyEventHasProductId(startNode.entryBehavior)
      ) {
        throw new ApiError(
          409,
          'CAMPAIGN_GOAL_PRODUCT_REQUIRED',
          '活动目标要按同一件商品算，但这个旅程的开始步骤没有商品，无法判断是否达成。请把开始步骤换成带商品的类型，或取消“只算同一件商品”。',
        );
      }

      const latest = await tx.journeyVersion.findFirst({
        where: { journeyId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const snapshotMeta = journeyVersionSnapshotMetaSchema.safeParse({
        name: journey.name,
        description: journey.description,
        entrySegment:
          segment === null
            ? null
            : {
                id: segment.id,
                name: segment.name,
                revision: segment.revision,
                rules: segment.rules,
              },
      });
      if (!snapshotMeta.success) {
        throw new ApiError(
          409,
          'JOURNEY_DRAFT_INVALID',
          '该旅程已保存的内容无法用于发布，请重新保存编排',
        );
      }
      const snapshot: JourneyVersionSnapshot = {
        ...snapshotMeta.data,
        definition: definition.data,
      };

      const created = await tx.journeyVersion.create({
        data: {
          journeyId,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          sourceRevision: input.revision,
          sourceSegmentRevision: input.segmentRevision,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          publishedById: accountId,
          publishedAt: this.now(),
        },
        select: versionDetailSelect,
      });
      return { version: serializeDetail(created), created: true };
    });
  }

  async list(journeyId: string, input: JourneyVersionListQuery) {
    const journey = await this.prisma.journey.findUnique({
      where: { id: journeyId },
      select: { id: true },
    });
    if (journey === null) throw journeyNotFound();

    const total = await this.prisma.journeyVersion.count({ where: { journeyId } });
    const lastPage = Math.max(1, Math.ceil(total / input.pageSize));
    const page = Math.min(input.page, lastPage);
    const records = await this.prisma.journeyVersion.findMany({
      where: { journeyId },
      skip: (page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
      select: versionSummarySelect,
    });

    return {
      data: records.map(serializeSummary),
      page: { page, pageSize: input.pageSize, total },
    };
  }

  async get(journeyId: string, versionId: string): Promise<JourneyVersionDetail> {
    // 同时限定旅程：把其他旅程的版本标识放到本旅程链接里按不存在处理。
    const record = await this.prisma.journeyVersion.findFirst({
      where: { id: versionId, journeyId },
      select: versionDetailSelect,
    });
    if (record === null) throw versionNotFound();
    return serializeDetail(record);
  }

  /**
   * 版本运行统计：执行状态分布来自执行记录，节点指标来自步骤记录。
   * 两组数字来源不同，读取放在一个 RepeatableRead 只读事务里，保证同一次响应使用同一个数据库快照，
   * 不会出现汇总仍显示等待、节点表却已显示正常结束的混读。只做普通查询，不加锁、不写入。
   */
  async getStats(journeyId: string, versionId: string): Promise<JourneyVersionStats> {
    return this.prisma.$transaction(
      async (tx) => {
        const version = await tx.journeyVersion.findFirst({
          where: { id: versionId, journeyId },
          select: { snapshot: true },
        });
        if (version === null) throw versionNotFound();
        const { definition } = version.snapshot as JourneyVersionSnapshot;

        const executions = await tx.execution.findMany({
          where: { journeyVersionId: versionId },
          select: { status: true, audienceUserId: true },
        });
        const steps = await tx.executionStep.findMany({
          where: { execution: { journeyVersionId: versionId } },
          select: { nodeId: true, status: true, output: true },
        });

        const statusCounts: Record<ExecutionStatus, number> = {
          running: 0,
          waiting: 0,
          completed: 0,
          failed: 0,
          stopped: 0,
        };
        const audienceUserIds = new Set<string>();
        for (const execution of executions) {
          statusCounts[execution.status] += 1;
          audienceUserIds.add(execution.audienceUserId);
        }

        return {
          executionCount: executions.length,
          audienceCount: audienceUserIds.size,
          statusCounts,
          nodes: aggregateNodeStats(definition.nodes, steps),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
