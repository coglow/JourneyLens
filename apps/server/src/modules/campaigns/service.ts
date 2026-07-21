import { Prisma, type PrismaClient } from '@prisma/client';
import {
  type CampaignCreate,
  type CampaignListQuery,
  type CampaignUpdate,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';

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

export class CampaignService {
  constructor(private readonly prisma: PrismaClient) {}

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
              { name: { contains: input.q, mode: 'insensitive' } },
              { description: { contains: input.q, mode: 'insensitive' } },
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

    const result = await this.prisma.campaign.updateMany({ where: { id }, data });
    return result.count === 0 ? null : this.get(id);
  }

  async deleteDraft(id: string) {
    try {
      const result = await this.prisma.campaign.deleteMany({ where: { id, status: 'draft' } });
      return result.count > 0;
    } catch (error) {
      // journeys.campaign_id 使用 RESTRICT：活动中还有旅程时数据库会阻止删除，这里转换成明确提示。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ApiError(409, 'CAMPAIGN_HAS_JOURNEYS', '活动中还有旅程，请先删除旅程');
      }
      throw error;
    }
  }
}
