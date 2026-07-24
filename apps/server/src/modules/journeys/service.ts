import { Prisma, type PrismaClient } from '@prisma/client';
import {
  type JourneyCreate,
  type JourneyDetail,
  type JourneyDraftDefinition,
  type JourneyDraftSave,
  type JourneyListItem,
  type JourneyListQuery,
  type JourneyUpdate,
  type SegmentRule,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';

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
} as const;

type JourneyDetailRecord = Prisma.JourneyGetPayload<{ select: typeof journeyDetailSelect }>;
type JourneyListItemRecord = Prisma.JourneyGetPayload<{ select: typeof journeyListItemSelect }>;

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
  return {
    ...record,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function notDraft(): ApiError {
  return new ApiError(409, 'CAMPAIGN_NOT_DRAFT', '只有草稿活动可以维护旅程');
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

  async create(
    campaignId: string,
    input: JourneyCreate,
    accountId: string,
  ): Promise<JourneyDetail> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (campaign === null) throw new ApiError(404, 'NOT_FOUND', '活动不存在');
    if (campaign.status !== 'draft') throw notDraft();
    if (input.segmentId !== null) await this.assertSegmentExists(input.segmentId);

    try {
      const record = await this.prisma.journey.create({
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
  }

  async get(id: string): Promise<JourneyDetail | null> {
    const record = await this.prisma.journey.findUnique({
      where: { id },
      select: journeyDetailSelect,
    });
    return record === null ? null : serializeDetail(record);
  }

  async update(id: string, input: JourneyUpdate, accountId: string): Promise<JourneyDetail> {
    const existing = await this.prisma.journey.findUnique({
      where: { id },
      select: { campaign: { select: { status: true } } },
    });
    if (existing === null) throw new ApiError(404, 'NOT_FOUND', '旅程不存在');
    if (existing.campaign.status !== 'draft') throw notDraft();
    if (input.segmentId !== undefined && input.segmentId !== null) {
      await this.assertSegmentExists(input.segmentId);
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
      const updated = await this.prisma.journey.update({
        where: { id, revision: input.revision },
        data,
        select: journeyDetailSelect,
      });
      return serializeDetail(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        // 条件未命中可能是记录被删除，也可能是 revision 已过期，分别给出反馈。
        const current = await this.prisma.journey.findUnique({
          where: { id },
          select: { id: true },
        });
        if (current === null) throw new ApiError(404, 'NOT_FOUND', '旅程不存在');
        throw new ApiError(409, 'JOURNEY_REVISION_CONFLICT', '旅程已被修改，请重新读取后再保存');
      }
      return rethrowWriteError(error);
    }
  }

  async saveDraft(id: string, input: JourneyDraftSave, accountId: string): Promise<JourneyDetail> {
    try {
      // 修订号和活动状态同时作为写入条件：任一不满足都不会覆盖别人的内容，
      // 也不会把草稿写入已排期或运行中的活动。
      const updated = await this.prisma.journey.update({
        where: { id, revision: input.revision, campaign: { status: 'draft' } },
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
        const current = await this.prisma.journey.findUnique({
          where: { id },
          select: { campaign: { select: { status: true } } },
        });
        if (current === null) throw new ApiError(404, 'NOT_FOUND', '旅程不存在');
        if (current.campaign.status !== 'draft') throw notDraft();
        throw new ApiError(409, 'JOURNEY_REVISION_CONFLICT', '旅程已被修改，请重新读取后再保存');
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    // 活动状态作为删除条件，避免先读状态再删除之间活动状态被改变。
    const result = await this.prisma.journey.deleteMany({
      where: { id, campaign: { status: 'draft' } },
    });
    if (result.count > 0) return;

    const existing = await this.prisma.journey.findUnique({
      where: { id },
      select: { campaign: { select: { status: true } } },
    });
    if (existing === null) throw new ApiError(404, 'NOT_FOUND', '旅程不存在');
    throw notDraft();
  }

  private async assertSegmentExists(segmentId: string): Promise<void> {
    const segment = await this.prisma.segment.findUnique({
      where: { id: segmentId },
      select: { id: true },
    });
    if (segment === null) throw segmentMissing();
  }
}
