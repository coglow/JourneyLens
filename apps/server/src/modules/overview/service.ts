import type { PrismaClient } from '@prisma/client';
import type { Overview } from '@journeylens/shared';

const OVERVIEW_WINDOW_MS = 168 * 60 * 60 * 1000;

export class OverviewService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getSnapshot(): Promise<Overview> {
    const end = this.now();
    const start = new Date(end.getTime() - OVERVIEW_WINDOW_MS);
    const range = { gte: start, lte: end };

    return this.prisma.$transaction(
      async (tx) => {
        const campaignGroups = await tx.campaign.groupBy({
          by: ['status'],
          _count: { _all: true },
        });
        const campaignStatusCounts = { draft: 0, running: 0, paused: 0, stopped: 0 };
        for (const group of campaignGroups) {
          campaignStatusCounts[group.status] = group._count._all;
        }
        const entryCount = await tx.execution.count({ where: { createdAt: range } });
        // 目标按行为发生的接收时间统计，失败按确认退出的时间统计。
        const goalReachedCount = await tx.execution.count({ where: { goalReachedAt: range } });
        const failedCount = await tx.execution.count({
          where: { endedAt: range, status: 'failed' },
        });

        const publishedJourneys = await tx.journey.findMany({
          where: { versions: { some: {} } },
          select: {
            id: true,
            name: true,
            campaign: { select: { id: true, name: true, status: true } },
            versions: {
              orderBy: { versionNumber: 'desc' },
              take: 1,
              select: { id: true, versionNumber: true, publishedAt: true },
            },
          },
        });
        const recentJourneys = publishedJourneys
          .flatMap((row) => {
            const latest = row.versions[0];
            return latest === undefined ? [] : [{ row, latest }];
          })
          // 发布时间相同的旅程按 ID 降序，保证每次读取顺序稳定。
          .sort(
            (a, b) =>
              b.latest.publishedAt.getTime() - a.latest.publishedAt.getTime() ||
              b.row.id.localeCompare(a.row.id),
          )
          .slice(0, 5)
          .map(({ row, latest }) => ({
            id: row.id,
            name: row.name,
            campaign: row.campaign,
            versionId: latest.id,
            versionNumber: latest.versionNumber,
            publishedAt: latest.publishedAt.toISOString(),
          }));

        const recent = await tx.execution.groupBy({
          by: ['campaignId'],
          where: { createdAt: range },
          _count: { _all: true },
          _max: { createdAt: true },
          orderBy: [{ _max: { createdAt: 'desc' } }, { campaignId: 'desc' }],
          take: 10,
        });
        const recentCampaigns: Overview['recentCampaigns'] = [];
        if (recent.length > 0) {
          const campaignId = { in: recent.map((row) => row.campaignId) };
          const campaigns = await tx.campaign.findMany({
            where: { id: campaignId },
            select: { id: true, name: true, status: true, goalEventType: true },
          });
          const goals = await tx.execution.groupBy({
            by: ['campaignId'],
            where: { campaignId, goalReachedAt: range },
            _count: { _all: true },
          });
          const failures = await tx.execution.groupBy({
            by: ['campaignId'],
            where: { campaignId, status: 'failed', endedAt: range },
            _count: { _all: true },
          });
          for (const row of recent) {
            const campaign = campaigns.find((item) => item.id === row.campaignId)!;
            recentCampaigns.push({
              id: campaign.id,
              name: campaign.name,
              status: campaign.status,
              entryCount: row._count._all,
              goalReachedCount:
                campaign.goalEventType === null
                  ? null
                  : (goals.find((item) => item.campaignId === campaign.id)?._count._all ?? 0),
              failedCount:
                failures.find((item) => item.campaignId === campaign.id)?._count._all ?? 0,
            });
          }
        }

        return {
          windowStartedAt: start.toISOString(),
          windowEndedAt: end.toISOString(),
          campaignStatusCounts,
          entryCount,
          goalReachedCount,
          failedCount,
          recentJourneys,
          recentCampaigns,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
