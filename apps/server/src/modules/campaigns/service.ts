import { Prisma, type PrismaClient } from '@prisma/client';
import {
  type CampaignCreate,
  type CampaignListQuery,
  type CampaignUpdate,
} from '@journeylens/shared';

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
    const data = await this.prisma.campaign.findMany({
      where: filters,
      skip: (page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, name: true, status: true, updatedAt: true },
    });

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
    const result = await this.prisma.campaign.deleteMany({ where: { id, status: 'draft' } });
    return result.count > 0;
  }
}
