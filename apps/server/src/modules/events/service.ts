import { isDeepStrictEqual } from 'node:util';
import { Prisma, type PrismaClient } from '@prisma/client';
import { evaluateSegmentRule, type SegmentAudienceInput } from '../segments/rule-evaluator.js';
import type {
  EventDetail,
  EventExecutionListQuery,
  EventIngest,
  EventIngestResult,
  EventListQuery,
  EventRelatedExecution,
  JourneyVersionSnapshot,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import { lockCampaignForExecution } from '../campaigns/campaign-lock.js';

const eventRepeatSelect = {
  id: true,
  type: true,
  audienceUserId: true,
  payload: true,
  receivedAt: true,
  executions: { select: { id: true } },
} as const;

type EventRepeatRecord = Prisma.EventGetPayload<{ select: typeof eventRepeatSelect }>;

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * 接收上游业务行为并创建真实执行。
 *
 * 行为、入口判断和新建执行在同一个事务里完成：失败全部回滚，不会出现“行为已保存但部分旅程进入”的中间结果。
 * 同一 ID 的并发重试由行为主键兜底，事务冲突后重新读取原事实，不重复读取画像或匹配版本。
 */
export class EventService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(input: EventListQuery) {
    const keyword = input.q === undefined ? undefined : escapeLikePattern(input.q);
    const where: Prisma.EventWhereInput = {
      ...(input.eventId ? { id: input.eventId } : {}),
      ...(input.type ? { type: input.type } : {}),
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
      ...(input.receivedFrom || input.receivedTo
        ? {
            receivedAt: {
              ...(input.receivedFrom ? { gte: new Date(input.receivedFrom) } : {}),
              ...(input.receivedTo ? { lte: new Date(input.receivedTo) } : {}),
            },
          }
        : {}),
    };

    const total = await this.prisma.event.count({ where });
    const lastPage = Math.max(1, Math.ceil(total / input.pageSize));
    const page = Math.min(input.page, lastPage);
    const records = await this.prisma.event.findMany({
      where,
      skip: (page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        type: true,
        receivedAt: true,
        audienceUser: { select: { externalId: true, displayName: true } },
      },
    });

    return {
      data: records.map((record) => ({
        id: record.id,
        type: record.type,
        receivedAt: record.receivedAt.toISOString(),
        audience: record.audienceUser,
      })),
      page: { page, pageSize: input.pageSize, total },
    };
  }

  async get(id: string): Promise<EventDetail> {
    const record = await this.prisma.event.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        receivedAt: true,
        payload: true,
        audienceUser: { select: { externalId: true, displayName: true } },
      },
    });
    if (record === null) throw new ApiError(404, 'NOT_FOUND', '行为记录不存在');

    return {
      id: record.id,
      type: record.type,
      receivedAt: record.receivedAt.toISOString(),
      payload: record.payload as EventDetail['payload'],
      audience: record.audienceUser,
    };
  }

  async listExecutions(id: string, input: EventExecutionListQuery) {
    const event = await this.prisma.event.findUnique({ where: { id }, select: { id: true } });
    if (event === null) throw new ApiError(404, 'NOT_FOUND', '行为记录不存在');

    // 每行对应一条旅程参与记录；同一参与可保留进入和结束等待两种事实，不按旅程名称合并。
    const where: Prisma.ExecutionWhereInput = {
      OR: [{ triggerEventId: id }, { steps: { some: { matchedEventId: id } } }],
    };
    const { total, page, records } = await this.prisma.$transaction(async (transaction) => {
      const total = await transaction.execution.count({ where });
      const lastPage = Math.max(1, Math.ceil(total / input.pageSize));
      const page = Math.min(input.page, lastPage);
      const records = await transaction.execution.findMany({
        where,
        skip: (page - 1) * input.pageSize,
        take: input.pageSize,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          triggerEventId: true,
          status: true,
          startedAt: true,
          campaign: { select: { id: true, name: true } },
          journey: { select: { id: true, name: true } },
          journeyVersion: { select: { id: true, versionNumber: true, snapshot: true } },
          steps: {
            where: { matchedEventId: id },
            select: { nodeId: true, endedAt: true },
          },
        },
      });
      return { total, page, records };
    });

    return {
      data: records.map((record) => {
        const matchedStep = record.steps[0];
        let step: EventRelatedExecution['matchedStep'] = null;
        if (matchedStep !== undefined) {
          const snapshot = record.journeyVersion.snapshot as unknown as JourneyVersionSnapshot;
          // 等待步骤名称来自执行绑定的发布版本，避免当前草稿改名后误读历史配置。
          const node = snapshot.definition.nodes.find((item) => item.id === matchedStep.nodeId);
          if (node === undefined) throw new Error('执行等待步骤不在固定版本中');
          step = {
            nodeId: matchedStep.nodeId,
            nodeName: node.name,
            endedWaitingAt: matchedStep.endedAt?.toISOString() ?? null,
          };
        }

        return {
          id: record.id,
          status: record.status,
          startedAt: record.startedAt.toISOString(),
          enteredByEvent: record.triggerEventId === id,
          campaign: record.campaign,
          journey: record.journey,
          version: {
            id: record.journeyVersion.id,
            versionNumber: record.journeyVersion.versionNumber,
          },
          matchedStep: step,
        } satisfies EventRelatedExecution;
      }),
      page: { page, pageSize: input.pageSize, total },
    };
  }

  async ingest(input: EventIngest): Promise<EventIngestResult> {
    const audience = await this.prisma.audienceUser.findUnique({
      where: { externalId: input.audienceExternalId },
      select: { id: true, displayName: true, email: true, attributes: true },
    });
    if (audience === null) {
      throw new ApiError(404, 'AUDIENCE_NOT_FOUND', '用户不存在，请先准备用户资料');
    }

    const receivedAt = this.now();
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // 已提交的重复 ID 直接返回原事实；并发场景由下面的唯一约束兜底。
          const repeated = await this.repeatedResult(tx, input, audience.id);
          if (repeated !== null) return repeated;

          const event = await tx.event.create({
            data: {
              id: input.id,
              audienceUserId: audience.id,
              type: input.type,
              payload: input.payload as Prisma.InputJsonValue,
              audienceSnapshot: {
                displayName: audience.displayName,
                email: audience.email,
                attributes: audience.attributes,
              } as Prisma.InputJsonValue,
              receivedAt,
            },
            select: { id: true, receivedAt: true },
          });

          const executions = await this.createMatchingExecutions(tx, {
            eventId: event.id,
            eventType: input.type,
            audience,
            receivedAt,
          });

          return {
            event: { id: event.id, receivedAt: event.receivedAt.toISOString() },
            executions: executions.map((execution) => ({ id: execution.id })),
            duplicate: false,
          };
        },
        { timeout: 15_000 },
      );
    } catch (error) {
      // 只转换行为 ID 的并发重复；其他唯一约束或数据库错误如实失败。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const repeated = await this.repeatedResult(this.prisma, input, audience.id);
        if (repeated !== null) return repeated;
      }
      throw error;
    }
  }

  /** 同一行为 ID 只允许一种内容；内容相同返回原执行，不同则明确拒绝。 */
  private async repeatedResult(
    client: PrismaClient | Prisma.TransactionClient,
    input: EventIngest,
    audienceUserId: string,
  ): Promise<EventIngestResult | null> {
    const existing = await client.event.findUnique({
      where: { id: input.id },
      select: eventRepeatSelect,
    });
    if (existing === null) return null;
    if (!this.sameEventContent(existing, input, audienceUserId)) {
      throw new ApiError(409, 'EVENT_ID_CONFLICT', '该行为 ID 已被其他内容使用');
    }
    return {
      event: { id: existing.id, receivedAt: existing.receivedAt.toISOString() },
      executions: existing.executions.map((execution) => ({ id: execution.id })),
      duplicate: true,
    };
  }

  private sameEventContent(
    existing: EventRepeatRecord,
    input: EventIngest,
    audienceUserId: string,
  ): boolean {
    // JSONB 会调整对象键顺序，深比较按结构判断内容是否相同。
    return (
      existing.type === input.type &&
      existing.audienceUserId === audienceUserId &&
      isDeepStrictEqual(existing.payload, input.payload)
    );
  }

  /**
   * 先锁定所有当前进行中的活动，再逐旅程选择最新已发布版本。
   * 新进入与暂停、停止互斥；暂停期间保存的行为不会补判，恢复后只对之后的新行为开放。
   */
  private async createMatchingExecutions(
    tx: Prisma.TransactionClient,
    input: {
      eventId: string;
      eventType: EventIngest['type'];
      audience: SegmentAudienceInput & { id: string };
      receivedAt: Date;
    },
  ): Promise<Array<{ id: string }>> {
    const candidates = await tx.campaign.findMany({
      where: { status: 'running' },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    const runningCampaignIds: string[] = [];
    for (const campaign of candidates) {
      const status = await lockCampaignForExecution(tx, campaign.id);
      if (status === 'running') runningCampaignIds.push(campaign.id);
    }
    if (runningCampaignIds.length === 0) return [];

    const journeys = await tx.journey.findMany({
      where: { campaignId: { in: runningCampaignIds } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        campaignId: true,
        // 新行为只使用版本号最大的已发布版本；最新版本不匹配时也不回退到旧版。
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { id: true, snapshot: true },
        },
      },
    });

    const created: Array<{ id: string }> = [];
    for (const journey of journeys) {
      const version = journey.versions[0];
      if (version === undefined) continue;

      const snapshot = version.snapshot as unknown as JourneyVersionSnapshot;
      const start = snapshot.definition.nodes.find((node) => node.type === 'start');
      if (start === undefined || start.entryBehavior !== input.eventType) continue;

      // 入口人群来自发布时固定的分群快照，不读取当前草稿或当前分群规则；不绑定分群表示不限人群。
      if (
        snapshot.entrySegment !== null &&
        !evaluateSegmentRule(snapshot.entrySegment.rules, input.audience)
      ) {
        continue;
      }

      const execution = await tx.execution.create({
        data: {
          campaignId: journey.campaignId,
          journeyId: journey.id,
          journeyVersionId: version.id,
          audienceUserId: input.audience.id,
          triggerEventId: input.eventId,
          status: 'running',
          currentNodeId: start.id,
          createdAt: input.receivedAt,
          startedAt: input.receivedAt,
        },
        select: { id: true },
      });
      created.push(execution);
    }

    return created;
  }
}
