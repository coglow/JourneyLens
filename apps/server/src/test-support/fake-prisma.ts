import type { Prisma, PrismaClient } from '@prisma/client';
import type { CampaignStatus } from '@journeylens/shared';
import { vi } from 'vitest';

export const accountId = 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120';
export const now = new Date('2026-07-16T08:00:00.000Z');

export interface TestAccount {
  id: string;
  email: string;
  emailNormalized: string;
  passwordHash: string;
  displayName: string;
  status: 'active' | 'disabled';
  lastLoginAt: Date | null;
}

export interface TestSession {
  id: string;
  accountId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface TestCampaign {
  id: string;
  name: string;
  description: string | null;
  budget: Prisma.Decimal | null;
  status: CampaignStatus;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: string; displayName: string };
}

export function makePrisma(initialStatus: TestAccount['status'] = 'active') {
  let account: TestAccount = {
    id: accountId,
    email: 'Operator@Example.com',
    emailNormalized: 'operator@example.com',
    passwordHash: 'stored-argon2-hash',
    displayName: '测试运营账号',
    status: initialStatus,
    lastLoginAt: null,
  };
  const sessions = new Map<string, TestSession>();
  const campaigns: TestCampaign[] = [];
  let campaignNumber = 0;
  const client: {
    operatorAccount: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    session: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    campaign: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
    $disconnect: ReturnType<typeof vi.fn>;
  } = {
    operatorAccount: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; emailNormalized?: string } }) => {
        if (where.id !== undefined) return account.id === where.id ? account : null;
        return account.emailNormalized === where.emailNormalized ? account : null;
      }),
      update: vi.fn(async ({ data }: { data: { lastLoginAt: Date } }) => {
        account = { ...account, lastLoginAt: data.lastLoginAt };
        return account;
      }),
    },
    session: {
      create: vi.fn(async ({ data }: { data: TestSession }) => {
        sessions.set(data.tokenHash, { ...data, revokedAt: null });
        return data;
      }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const session = sessions.get(where.tokenHash);
        return session === undefined ? null : { ...session, account };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { tokenHash: string; revokedAt: null };
          data: { revokedAt: Date };
        }) => {
          const session = sessions.get(where.tokenHash);
          if (session === undefined || session.revokedAt !== where.revokedAt) return { count: 0 };
          sessions.set(where.tokenHash, { ...session, revokedAt: data.revokedAt });
          return { count: 1 };
        },
      ),
    },
    campaign: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<TestCampaign, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'createdBy'>;
        }) => {
          campaignNumber += 1;
          const campaign: TestCampaign = {
            ...data,
            id: `00000000-0000-4000-8000-${String(campaignNumber).padStart(12, '0')}`,
            status: 'draft',
            createdAt: now,
            updatedAt: now,
            createdBy: { id: account.id, displayName: account.displayName },
          };
          campaigns.push(campaign);
          const { id, name, description, budget, status, createdAt, updatedAt, createdBy } =
            campaign;
          return { id, name, description, budget, status, createdAt, updatedAt, createdBy };
        },
      ),
      findMany: vi.fn(async ({ skip, take }: { skip: number; take: number }) =>
        [...campaigns]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
          .slice(skip, skip + take)
          .map(({ id, name, status, updatedAt }) => ({ id, name, status, updatedAt })),
      ),
      count: vi.fn(async () => campaigns.length),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const campaign = campaigns.find((item) => item.id === where.id);
        if (campaign === undefined) return null;
        const { id, name, description, budget, status, createdAt, updatedAt, createdBy } = campaign;
        return { id, name, description, budget, status, createdAt, updatedAt, createdBy };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: {
            name?: string;
            description?: string | null;
            budget?: Prisma.Decimal | null;
          };
        }) => {
          const campaign = campaigns.find((item) => item.id === where.id);
          if (campaign === undefined) return { count: 0 };
          Object.assign(campaign, data, { updatedAt: new Date(now.getTime() + 1000) });
          return { count: 1 };
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: { id: string; status: 'draft' } }) => {
        const index = campaigns.findIndex(
          (campaign) => campaign.id === where.id && campaign.status === where.status,
        );
        if (index < 0) return { count: 0 };
        campaigns.splice(index, 1);
        return { count: 1 };
      }),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(client)),
    $disconnect: vi.fn(async () => undefined),
  };

  return {
    prisma: client as unknown as PrismaClient,
    sessions,
    campaigns,
    campaignModel: client.campaign,
    setStatus(status: TestAccount['status']) {
      account = { ...account, status };
    },
  };
}
