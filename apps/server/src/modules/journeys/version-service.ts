import type { Prisma, PrismaClient } from '@prisma/client';
import {
  canEditCampaign,
  getJourneyDraftWarnings,
  journeyDraftDefinitionSchema,
  journeyVersionSnapshotMetaSchema,
  type JourneyVersionDetail,
  type JourneyVersionListQuery,
  type JourneyVersionPublish,
  type JourneyVersionSnapshot,
  type JourneyVersionSummary,
  type SegmentRule,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import { lockCampaignForJourneyWrite } from '../campaigns/campaign-lock.js';

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
      if (getJourneyDraftWarnings(definition.data).length > 0) {
        throw new ApiError(409, 'JOURNEY_DRAFT_INCOMPLETE', '请先补齐流程连接');
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
}
