import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  canEditCampaign,
  type JourneyAiDraftRequest,
  type JourneyAiDraftResult,
} from '@journeylens/shared';
import type { AiDraftModelConfig } from '../../config.js';
import { ApiError } from '../../errors.js';
import type { AiDraftModelCall } from './ai-draft-model.js';
import { parseAiDraftOutput } from './ai-draft-output.js';
import { buildAiDraftMessages } from './ai-draft-prompt.js';

/** 同一运营账号的频率窗口与实际生成尝试次数：失败尝试同样计数。 */
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_ATTEMPTS = 10;
const WINDOW_CLEANUP_INTERVAL_MS = 60_000;

export interface AiDraftServiceDeps {
  config: AiDraftModelConfig;
  callModel: AiDraftModelCall;
  now?: () => number;
}

/**
 * 一次生成的组织者：先确认旅程可起草，再占用一次生成机会，最后校验模型输出。
 * 模型请求期间不持有数据库事务或活动行锁；进程内记录在途与频率窗口，重启后清空。
 */
export class AiDraftService {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly inFlight = new Set<string>();
  private nextCleanupAt = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly deps: AiDraftServiceDeps,
  ) {}

  async generate(
    journeyId: string,
    input: JourneyAiDraftRequest,
    accountId: string,
    log: Pick<FastifyBaseLogger, 'info' | 'warn'>,
  ): Promise<JourneyAiDraftResult> {
    const journey = await this.prisma.journey.findUnique({
      where: { id: journeyId },
      select: { id: true, campaign: { select: { status: true } } },
    });
    if (journey === null) throw new ApiError(404, 'NOT_FOUND', '旅程不存在');
    if (!canEditCampaign(journey.campaign.status)) {
      throw new ApiError(409, 'CAMPAIGN_NOT_EDITABLE', '只有草稿或已暂停的活动可以起草旅程');
    }

    this.beginAttempt(accountId);
    try {
      const raw = await this.deps.callModel(this.deps.config, buildAiDraftMessages(input), log);
      return parseAiDraftOutput(raw, input.entryBehavior, log);
    } finally {
      // 客户端取消不会联动中止模型请求；在途标记按本次调用结束或超时释放。
      this.inFlight.delete(accountId);
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private beginAttempt(accountId: string): void {
    if (this.inFlight.has(accountId)) {
      throw new ApiError(429, 'AI_DRAFT_RATE_LIMITED', '请求过于频繁，请 60 秒后重试');
    }

    const now = this.now();
    if (now >= this.nextCleanupAt) {
      for (const [candidate, window] of this.windows) {
        if (window.resetAt <= now) this.windows.delete(candidate);
      }
      this.nextCleanupAt = now + WINDOW_CLEANUP_INTERVAL_MS;
    }

    let window = this.windows.get(accountId);
    if (window === undefined || window.resetAt <= now) {
      window = { count: 0, resetAt: now + RATE_WINDOW_MS };
      this.windows.set(accountId, window);
    }
    if (window.count >= RATE_MAX_ATTEMPTS) {
      throw new ApiError(429, 'AI_DRAFT_RATE_LIMITED', '起草请求过于频繁，请稍后再试', {
        retryAfterSeconds: Math.ceil((window.resetAt - now) / 1000),
      });
    }

    window.count += 1;
    this.inFlight.add(accountId);
  }
}
