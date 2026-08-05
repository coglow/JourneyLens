import { Prisma, type PrismaClient } from '@prisma/client';
import {
  canEditCampaign,
  type JourneyCreate,
  type JourneyDetail,
  type JourneyDraftDefinition,
  type JourneyDraftSave,
  type JourneyListItem,
  type JourneyListQuery,
  type JourneySimulation,
  type JourneySimulationResult,
  type JourneyStatsItem,
  type JourneyStatsListQuery,
  type JourneyUpdate,
  type SegmentRule,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import { lockCampaignForJourneyWrite } from '../campaigns/campaign-lock.js';
import { JourneySimulationMessageError, simulateJourney } from './simulation.js';

const journeyDetailSelect = {
  id: true,
  name: true,
  description: true,
  draftDefinition: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  campaign: { select: { id: true, name: true, status: true } },
  segment: { select: { id: true, name: true, revision: true, rules: true } },
  createdBy: { select: { id: true, displayName: true } },
  updatedBy: { select: { id: true, displayName: true } },
} as const;

const journeyListItemSelect = {
  id: true,
  name: true,
  description: true,
  updatedAt: true,
  segment: { select: { id: true, name: true } },
  _count: { select: { versions: true } },
} as const;

// 统计入口只需要所属活动和最新发布版本的标识，不读取快照，避免把大 JSON 带进列表。
const journeyStatsItemSelect = {
  id: true,
  name: true,
  campaign: { select: { id: true, name: true, status: true } },
  versions: {
    orderBy: { versionNumber: 'desc' },
    take: 1,
    select: { id: true, versionNumber: true, publishedAt: true },
  },
} as const;

type JourneyDetailRecord = Prisma.JourneyGetPayload<{ select: typeof journeyDetailSelect }>;
type JourneyListItemRecord = Prisma.JourneyGetPayload<{ select: typeof journeyListItemSelect }>;
type JourneyStatsItemRecord = Prisma.JourneyGetPayload<{ select: typeof journeyStatsItemSelect }>;

function serializeDetail(record: JourneyDetailRecord): JourneyDetail {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    revision: record.revision,
    campaign: record.campaign,
    segment:
      record.segment === null
        ? null
        : { ...record.segment, rules: record.segment.rules as unknown as SegmentRule },
    draftDefinition: record.draftDefinition as JourneyDraftDefinition | null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
  };
}

function serializeListItem(record: JourneyListItemRecord): JourneyListItem {
  const { _count, ...rest } = record;
  return {
    ...rest,
    // 版本数量只用于判断删除是否可用，不把关联查询结构带进响应。
    versionCount: _count.versions,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function serializeStatsItem(record: JourneyStatsItemRecord): JourneyStatsItem {
  // 查询条件已限定存在发布版本，且 take:1 与条件在同一条查询里取值，因此这里一定有最新版本。
  const latestVersion = record.versions[0]!;
  return {
    id: record.id,
    name: record.name,
    campaign: record.campaign,
    latestVersion: {
      id: latestVersion.id,
      versionNumber: latestVersion.versionNumber,
      publishedAt: latestVersion.publishedAt.toISOString(),
    },
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** 草稿与暂停都是维护窗口； */
function notEditable(message: string): ApiError {
  return new ApiError(409, 'CAMPAIGN_NOT_EDITABLE', message);
}

function journeyMissing(): ApiError {
  return new ApiError(404, 'NOT_FOUND', '旅程不存在');
}

function segmentMissing(): ApiError {
  return new ApiError(400, 'SEGMENT_NOT_FOUND', '选择的分群不存在，请重新选择');
}

/**
 * 名称唯一和关联对象最终由数据库约束保证：并发创建同名旅程或分群刚被删除时，
 * 这里把约束错误转换成可理解的业务反馈，其他异常仍交给统一错误处理。
 */
function rethrowWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new ApiError(409, 'JOURNEY_NAME_TAKEN', '该活动内已有同名旅程');
    }
    if (error.code === 'P2003') {
      throw new ApiError(
        409,
        'JOURNEY_ASSOCIATION_MISSING',
        '活动或所选分群已不存在，请刷新后重试',
      );
    }
  }
  throw error;
}

export class JourneyService {
  constructor(private readonly prisma: PrismaClient) {}

  async listByCampaign(campaignId: string, input: JourneyListQuery) {
    // 活动不存在时明确反馈，不返回看似正常的空列表。
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true },
    });
    if (campaign === null) throw new ApiError(404, 'NOT_FOUND', '活动不存在');

    const filters: Prisma.JourneyWhereInput = {
      campaignId,
      ...(input.q
        ? {
            OR: [
              { name: { contains: escapeLikePattern(input.q), mode: 'insensitive' } },
              { description: { contains: escapeLikePattern(input.q), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const total = await this.prisma.journey.count({ where: filters });
    // 删除或筛选后页码可能越界，直接落到最后一个有效页；空数据时回到第 1 页。
    const lastPage = Math.max(1, Math.ceil(total / input.pageSize));
    const page = Math.min(input.page, lastPage);
    const records = await this.prisma.journey.findMany({
      where: filters,
      skip: (page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: journeyListItemSelect,
    });

    return {
      data: records.map(serializeListItem),
      page: { page, pageSize: input.pageSize, total },
    };
  }

  /**
   * 旅程统计入口：跨活动列出已有发布版本的旅程，并带出所属活动与最新发布版本。
   * 只按旅程名称搜索（活动内旅程列表是名称 + 说明），未发布旅程不出现，执行记录数量不参与筛选。
   */
  async listWithPublishedVersions(input: JourneyStatsListQuery) {
    const where: Prisma.JourneyWhereInput = {
      versions: { some: {} },
      ...(input.campaignId === undefined ? {} : { campaignId: input.campaignId }),
      ...(input.q === undefined
        ? {}
        : { name: { contains: escapeLikePattern(input.q), mode: 'insensitive' } }),
    };
    const total = await this.prisma.journey.count({ where });
    // 删除或筛选后页码可能越界，直接落到最后一个有效页；空数据时回到第 1 页。
    const lastPage = Math.max(1, Math.ceil(total / input.pageSize));
    const page = Math.min(input.page, lastPage);
    const records = await this.prisma.journey.findMany({
      where,
      skip: (page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: journeyStatsItemSelect,
    });

    return {
      data: records.map(serializeStatsItem),
      page: { page, pageSize: input.pageSize, total },
    };
  }

  async create(
    campaignId: string,
    input: JourneyCreate,
    accountId: string,
  ): Promise<JourneyDetail> {
    return this.prisma.$transaction(async (tx) => {
      // 与状态动作共用活动行锁：启动、恢复提交后这里必定读到不可编辑状态，
      // 不会在只读活动里新增旅程；暂停下则按维护窗口放行。
      const status = await lockCampaignForJourneyWrite(tx, campaignId);
      if (status === null) throw new ApiError(404, 'NOT_FOUND', '活动不存在');
      if (!canEditCampaign(status)) throw notEditable('只有草稿或已暂停的活动可以新建旅程');
      if (input.segmentId !== null) await this.assertSegmentExists(tx, input.segmentId);

      try {
        const record = await tx.journey.create({
          data: {
            campaignId,
            segmentId: input.segmentId,
            name: input.name,
            description: input.description,
            createdById: accountId,
            updatedById: accountId,
          },
          select: journeyDetailSelect,
        });
        return serializeDetail(record);
      } catch (error) {
        return rethrowWriteError(error);
      }
    });
  }

  async get(id: string): Promise<JourneyDetail | null> {
    const record = await this.prisma.journey.findUnique({
      where: { id },
      select: journeyDetailSelect,
    });
    return record === null ? null : serializeDetail(record);
  }

  async update(id: string, input: JourneyUpdate, accountId: string): Promise<JourneyDetail> {
    return this.prisma.$transaction(async (tx) => {
      // 活动标识不可变：先普通读取取得归属，再按“活动 → 旅程”的顺序加锁。
      const existing = await tx.journey.findUnique({
        where: { id },
        select: { campaignId: true },
      });
      if (existing === null) throw journeyMissing();
      const status = await lockCampaignForJourneyWrite(tx, existing.campaignId);
      if (status === null) throw journeyMissing();
      if (!canEditCampaign(status)) throw notEditable('只有草稿或已暂停的活动可以修改旅程');
      if (input.segmentId !== undefined && input.segmentId !== null) {
        await this.assertSegmentExists(tx, input.segmentId);
      }

      // revision 同时出现在条件里；只有读取后未被别人改过，更新才会命中。
      const data: Prisma.JourneyUncheckedUpdateInput = {
        revision: { increment: 1 },
        updatedById: accountId,
      };
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;
      if (input.segmentId !== undefined) data.segmentId = input.segmentId;

      try {
        // 直接返回本次更新得到的记录，避免独立回读时混入别人的后续修改。
        const updated = await tx.journey.update({
          where: { id, revision: input.revision },
          data,
          select: journeyDetailSelect,
        });
        return serializeDetail(updated);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          // 条件未命中可能是记录被删除，也可能是 revision 已过期，分别给出反馈。
          const current = await tx.journey.findUnique({ where: { id }, select: { id: true } });
          if (current === null) throw journeyMissing();
          throw new ApiError(409, 'JOURNEY_REVISION_CONFLICT', '旅程已被修改，请重新读取后再保存');
        }
        return rethrowWriteError(error);
      }
    });
  }

  async saveDraft(id: string, input: JourneyDraftSave, accountId: string): Promise<JourneyDetail> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.journey.findUnique({
        where: { id },
        select: { campaignId: true },
      });
      if (existing === null) throw journeyMissing();
      // 活动状态在共享锁下确认并保持到提交；活动恢复或启动会等待本次保存结束。
      const status = await lockCampaignForJourneyWrite(tx, existing.campaignId);
      if (status === null) throw journeyMissing();
      if (!canEditCampaign(status)) throw notEditable('只有草稿或已暂停的活动可以修改旅程');

      try {
        const updated = await tx.journey.update({
          where: { id, revision: input.revision },
          data: {
            draftDefinition: input.draftDefinition as Prisma.InputJsonValue,
            revision: { increment: 1 },
            updatedById: accountId,
          },
          select: journeyDetailSelect,
        });
        // 直接返回本次写入的记录，避免独立回读时混入别人的后续修改。
        return serializeDetail(updated);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          const current = await tx.journey.findUnique({ where: { id }, select: { id: true } });
          if (current === null) throw journeyMissing();
          throw new ApiError(409, 'JOURNEY_REVISION_CONFLICT', '旅程已被修改，请重新读取后再保存');
        }
        throw error;
      }
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.journey.findUnique({
        where: { id },
        select: { campaignId: true },
      });
      if (existing === null) throw journeyMissing();
      const status = await lockCampaignForJourneyWrite(tx, existing.campaignId);
      if (status === null) throw journeyMissing();
      if (!canEditCampaign(status)) throw notEditable('只有草稿或已暂停的活动可以删除旅程');

      try {
        const result = await tx.journey.deleteMany({ where: { id } });
        // 期间被另一请求删除时按不存在反馈。
        if (result.count === 0) throw journeyMissing();
      } catch (error) {
        // journey_versions 外键使用 RESTRICT：已有发布版本时由数据库阻止删除。
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
          throw new ApiError(409, 'JOURNEY_HAS_VERSIONS', '该旅程已有发布版本，不能删除');
        }
        throw error;
      }
    });
  }

  /** 单次模拟只读取旅程与分群规则，使用本次填写的资料，不读取真实受众或写入业务数据。 */
  async simulate(journeyId: string, input: JourneySimulation): Promise<JourneySimulationResult> {
    const journey = await this.prisma.journey.findUnique({
      where: { id: journeyId },
      select: { id: true, segment: { select: { id: true, name: true, rules: true } } },
    });
    if (journey === null) throw new ApiError(404, 'NOT_FOUND', '旅程不存在');

    try {
      return simulateJourney({
        definition: input.draftDefinition,
        scenario: input.scenario,
        segment:
          journey.segment === null
            ? null
            : { ...journey.segment, rules: journey.segment.rules as unknown as SegmentRule },
      });
    } catch (error) {
      // 消息替换后的实际文案超长，用本次模拟请求的失败反馈说明具体步骤。
      if (error instanceof JourneySimulationMessageError) {
        throw new ApiError(400, 'BAD_REQUEST', error.message);
      }
      throw error;
    }
  }

  private async assertSegmentExists(
    client: Prisma.TransactionClient,
    segmentId: string,
  ): Promise<void> {
    const segment = await client.segment.findUnique({
      where: { id: segmentId },
      select: { id: true },
    });
    if (segment === null) throw segmentMissing();
  }
}
