import { Prisma, type PrismaClient } from '@prisma/client';
import {
  EDITABLE_CAMPAIGN_STATUSES,
  type CampaignCreate,
  type CampaignListQuery,
  type CampaignUpdate,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import { lockCampaignForTransition } from './campaign-lock.js';

const campaignDetailSelect = {
  id: true,
  name: true,
  description: true,
  budget: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, displayName: true } },
} as const;

type CampaignRecord = Prisma.CampaignGetPayload<{ select: typeof campaignDetailSelect }>;

function serializeCampaign(campaign: CampaignRecord) {
  return {
    ...campaign,
    budget: campaign.budget === null ? null : { amount: campaign.budget.toFixed(2) },
  };
}

function campaignMissing(): ApiError {
  return new ApiError(404, 'NOT_FOUND', '活动不存在');
}

/** 搜索词里的通配符按普通字符匹配，避免用户输入 % 或 _ 时命中全部记录。 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export class CampaignService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: CampaignCreate, accountId: string) {
    const campaign = await this.prisma.campaign.create({
      data: {
        name: input.name,
        description: input.description,
        budget:
          input.budget === undefined || input.budget === null
            ? null
            : new Prisma.Decimal(input.budget.amount),
        createdById: accountId,
      },
      select: campaignDetailSelect,
    });
    return serializeCampaign(campaign);
  }

  async list(input: CampaignListQuery) {
    const filters: Prisma.CampaignWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.q
        ? {
            OR: [
              { name: { contains: escapeLikePattern(input.q), mode: 'insensitive' } },
              { description: { contains: escapeLikePattern(input.q), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const total = await this.prisma.campaign.count({ where: filters });
    const lastPage = Math.max(1, Math.ceil(total / input.pageSize));
    const page = Math.min(input.page, lastPage);
    const campaigns = await this.prisma.campaign.findMany({
      where: filters,
      skip: (page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        name: true,
        description: true,
        budget: true,
        status: true,
        updatedAt: true,
        createdBy: { select: { id: true, displayName: true } },
        _count: { select: { journeys: true } },
      },
    });

    // 列表需要展示删除是否可用，因此一并返回阻止删除的旅程数量。
    // 预算与详情保持同样的结构，金额统一保留两位小数。
    const data = campaigns.map(({ _count, budget, ...campaign }) => ({
      ...campaign,
      budget: budget === null ? null : { amount: budget.toFixed(2) },
      journeyCount: _count.journeys,
    }));

    return {
      data,
      page: {
        page,
        pageSize: input.pageSize,
        total,
      },
    };
  }

  async get(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      select: campaignDetailSelect,
    });
    return campaign === null ? null : serializeCampaign(campaign);
  }

  async update(id: string, input: CampaignUpdate) {
    const data: Prisma.CampaignUpdateManyMutationInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.budget !== undefined) {
      data.budget = input.budget === null ? null : new Prisma.Decimal(input.budget.amount);
    }

    // 可编辑状态同时作为更新条件：恢复或停止持有同一行的排他锁，晚到的修改会等锁释放后
    // 重新检查条件而落空，不会出现“先读到暂停、恢复提交后仍然写入”的情况。
    const result = await this.prisma.campaign.updateMany({
      where: { id, status: { in: [...EDITABLE_CAMPAIGN_STATUSES] } },
      data,
    });
    if (result.count === 0) {
      await this.assertCampaignStatus(
        id,
        new ApiError(409, 'CAMPAIGN_NOT_EDITABLE', '只有草稿或已暂停的活动可以修改'),
      );
    }
    return this.get(id);
  }

  async deleteDraft(id: string): Promise<void> {
    try {
      // 删除不随编辑条件放宽：已启动或已暂停的活动都保留记录。
      const result = await this.prisma.campaign.deleteMany({ where: { id, status: 'draft' } });
      if (result.count === 0) {
        await this.assertCampaignStatus(
          id,
          new ApiError(409, 'CAMPAIGN_NOT_DRAFT', '只有草稿活动可以删除'),
        );
      }
    } catch (error) {
      // journeys.campaign_id 使用 RESTRICT：活动中还有旅程时数据库会阻止删除，这里转换成明确提示。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ApiError(409, 'CAMPAIGN_HAS_JOURNEYS', '活动中还有旅程，请先删除旅程');
      }
      throw error;
    }
  }

  /** 手动启动：至少一个旅程已有发布版本；启动后活动资料与旅程进入只读。 */
  async start(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const status = await lockCampaignForTransition(tx, id);
      if (status === null) throw campaignMissing();
      // 重复点击或响应丢失后的重试：已处于目标状态时返回详情，不重复写成新时间。
      if (status === 'running') return this.lockedDetail(tx, id);
      // 暂停只能通过恢复回到进行中，不能借首次启动绕过门槛语义。
      if (status === 'paused') {
        throw new ApiError(409, 'CAMPAIGN_INVALID_TRANSITION', '活动已暂停，请使用恢复活动');
      }
      if (status !== 'draft') {
        throw new ApiError(
          409,
          'CAMPAIGN_INVALID_TRANSITION',
          status === 'stopped' ? '活动已停止，不能再次启动' : '当前活动不能启动，请刷新后查看',
        );
      }

      // 未发布旅程和未发布修改不作为启动依据，只检查是否至少有一个已发布版本存在。
      const published = await tx.journeyVersion.findFirst({
        where: { journey: { campaignId: id } },
        select: { id: true },
      });
      if (published === null) {
        throw new ApiError(
          409,
          'CAMPAIGN_HAS_NO_PUBLISHED_JOURNEY',
          '请先发布至少一个旅程，再启动活动',
        );
      }

      const updated = await tx.campaign.update({
        where: { id },
        data: { status: 'running' },
        select: campaignDetailSelect,
      });
      return serializeCampaign(updated);
    });
  }

  /** 手动暂停：进行中进入维护窗口；已在暂停返回详情。 */
  async pause(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const status = await lockCampaignForTransition(tx, id);
      if (status === null) throw campaignMissing();
      if (status === 'paused') return this.lockedDetail(tx, id);
      if (status === 'stopped') {
        throw new ApiError(409, 'CAMPAIGN_INVALID_TRANSITION', '活动已停止，不能暂停');
      }
      if (status !== 'running') {
        throw new ApiError(409, 'CAMPAIGN_INVALID_TRANSITION', '当前活动不能暂停，请刷新后查看');
      }

      const updated = await tx.campaign.update({
        where: { id },
        data: { status: 'paused' },
        select: campaignDetailSelect,
      });
      return serializeCampaign(updated);
    });
  }

  /** 手动恢复：只从暂停回到进行中，不重复检查发布门槛，也不自动发布。 */
  async resume(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const status = await lockCampaignForTransition(tx, id);
      if (status === null) throw campaignMissing();
      if (status === 'running') return this.lockedDetail(tx, id);
      if (status === 'stopped') {
        throw new ApiError(409, 'CAMPAIGN_INVALID_TRANSITION', '活动已停止，不能恢复');
      }
      if (status !== 'paused') {
        throw new ApiError(409, 'CAMPAIGN_INVALID_TRANSITION', '当前活动不能恢复，请刷新后查看');
      }

      const updated = await tx.campaign.update({
        where: { id },
        data: { status: 'running' },
        select: campaignDetailSelect,
      });
      return serializeCampaign(updated);
    });
  }

  /** 手动停止：从进行中或暂停进入终态；停止后不能恢复，重复停止返回当前详情。 */
  async stop(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const status = await lockCampaignForTransition(tx, id);
      if (status === null) throw campaignMissing();
      if (status === 'stopped') return this.lockedDetail(tx, id);
      if (status !== 'running' && status !== 'paused') {
        throw new ApiError(409, 'CAMPAIGN_INVALID_TRANSITION', '只有进行中或已暂停的活动可以停止');
      }

      const stoppedAt = this.now();
      // 活动行排他锁持有到提交：执行步骤先取得共享锁时先完成当步，停止随后终止剩余运行。
      await tx.execution.updateMany({
        where: { campaignId: id, status: { in: ['running', 'waiting'] } },
        data: { status: 'stopped', endedAt: stoppedAt },
      });
      // 未结束的等待步骤同步停止；已完成步骤和消息记录保留原事实。
      await tx.executionStep.updateMany({
        where: { execution: { campaignId: id }, status: 'waiting' },
        data: { status: 'stopped', endedAt: stoppedAt },
      });

      const updated = await tx.campaign.update({
        where: { id },
        data: { status: 'stopped' },
        select: campaignDetailSelect,
      });
      return serializeCampaign(updated);
    });
  }

  /** 条件写未命中后区分“活动不存在”和“状态已不允许该操作”，错误内容由调用方给出。 */
  private async assertCampaignStatus(id: string, error: ApiError): Promise<never> {
    const existing = await this.prisma.campaign.findUnique({
      where: { id },
      select: { id: true },
    });
    if (existing === null) throw campaignMissing();
    throw error;
  }

  /** 事务内已经锁住活动行，读取详情时不会因并发删除返回空。 */
  private async lockedDetail(tx: Prisma.TransactionClient, id: string) {
    const campaign = await tx.campaign.findUniqueOrThrow({
      where: { id },
      select: campaignDetailSelect,
    });
    return serializeCampaign(campaign);
  }
}
