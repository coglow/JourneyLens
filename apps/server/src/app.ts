import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AuthService } from './modules/auth/auth-service.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerSessionGuard } from './modules/auth/session-plugin.js';
import { registerCampaignRoutes } from './modules/campaigns/routes.js';
import { registerEventRoutes } from './modules/events/routes.js';
import { registerExecutionRoutes } from './modules/executions/routes.js';
import { registerOverviewRoutes } from './modules/overview/routes.js';
import { registerJourneyRoutes } from './modules/journeys/routes.js';
import { registerSegmentRoutes } from './modules/segments/routes.js';
import { readAiDraftConfig, type AiDraftModelConfig } from './config.js';
import { createPrismaClient } from './db/client.js';
import { ApiError } from './errors.js';
import { callAiDraftModel, type AiDraftModelCall } from './modules/journeys/ai-draft-model.js';
import type { AiDraftServiceDeps } from './modules/journeys/ai-draft-service.js';
import { registerRequestSecurity } from './plugins/security.js';

const REQUEST_ID_PATTERN = /^[\x21-\x7E]{1,128}$/;

interface RequestErrorInfo {
  errorCode?: string;
  errorType?: string;
}

export type AppLoggerOption = false | { stream: { write(message: string): void } };

/** AI 起草的模型配置；测试可传 callModel 替身，不发出真实请求。 */
export interface AiDraftOption {
  config: AiDraftModelConfig;
  callModel?: AiDraftModelCall;
}

export interface BuildAppOptions {
  prisma?: PrismaClient;
  verifyPassword?: (hash: string, password: string) => Promise<boolean>;
  now?: () => Date;
  logger?: AppLoggerOption;
  aiDraft?: AiDraftOption;
}

/** 未显式提供时按环境变量决定；缺少密钥就不启用，生成接口会明确提示暂不可用。 */
function resolveAiDraftDeps(options: BuildAppOptions): AiDraftServiceDeps | undefined {
  const config = readAiDraftConfig(process.env);
  const option: AiDraftOption | undefined =
    options.aiDraft ?? (config === undefined ? undefined : { config });
  if (option === undefined) return undefined;

  const now = options.now;
  return {
    config: option.config,
    callModel: option.callModel ?? callAiDraftModel,
    ...(now === undefined ? {} : { now: () => now().getTime() }),
  };
}

function resolveRequestId(headerValue: unknown): string {
  if (typeof headerValue === 'string' && REQUEST_ID_PATTERN.test(headerValue)) {
    return headerValue;
  }
  return randomUUID();
}

function describeRequestError(error: unknown): RequestErrorInfo {
  if (error instanceof ApiError) return { errorCode: error.code };
  if (error instanceof Error) return { errorType: error.name || 'Error' };
  return { errorType: 'UnknownError' };
}

export function buildApp(options: BuildAppOptions = {}) {
  const databaseUrl = process.env.DATABASE_URL;
  if (options.prisma === undefined && !databaseUrl) {
    throw new Error('DATABASE_URL 未设置，请检查根目录 .env');
  }
  const ownsPrisma = options.prisma === undefined;
  const prisma = options.prisma ?? createPrismaClient(databaseUrl!);
  const requestErrors = new WeakMap<FastifyRequest, RequestErrorInfo>();
  const app = Fastify({
    logger: options.logger ?? true,
    logController: new Fastify.LogController({
      disableRequestLogging: true,
      requestIdLogLabel: 'requestId',
    }),
    genReqId: (request) => resolveRequestId(request.headers['x-request-id']),
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.addHook('onError', async (request, _reply, error) => {
    requestErrors.set(request, describeRequestError(error));
  });

  app.addHook('onResponse', async (request, reply) => {
    const statusCode = reply.statusCode;
    const route = request.routeOptions?.url;
    const fields = {
      method: request.method,
      route: typeof route === 'string' && route.length > 0 ? route : 'unmatched',
      statusCode,
      durationMs: Math.round(reply.elapsedTime),
      ...(requestErrors.get(request) ?? {}),
    };

    if (statusCode >= 500) {
      request.log.error(fields, '请求失败');
    } else if (statusCode >= 400) {
      request.log.warn(fields, '请求失败');
    } else {
      request.log.info(fields, '请求完成');
    }
  });

  app.register(cookie);
  registerRequestSecurity(app);

  const service = new AuthService({
    prisma,
    verifyPassword: options.verifyPassword,
    now: options.now,
  });
  registerSessionGuard(app, service);
  registerAuthRoutes(app, { service, now: options.now });
  registerCampaignRoutes(app, prisma, options.now);
  registerSegmentRoutes(app, prisma, options.now);
  registerJourneyRoutes(app, prisma, options.now, resolveAiDraftDeps(options));
  registerEventRoutes(app, prisma, options.now);
  registerExecutionRoutes(app, prisma);
  registerOverviewRoutes(app, prisma, options.now);

  app.get('/health/live', async () => ({ status: 'ok' as const }));

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    if (error instanceof ApiError) {
      if (error.retryAfterSeconds !== undefined) {
        reply.header('Retry-After', String(error.retryAfterSeconds));
      }
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    }

    // 请求体超过所设上限时给出可执行的说法，不退回“请求内容无效”。
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
    ) {
      return reply.code(413).send({
        error: { code: 'BAD_REQUEST', message: '提交内容过长，请精简后重试', requestId },
      });
    }

    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? error.statusCode
        : undefined;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: {
          code: statusCode === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'BAD_REQUEST',
          message: statusCode === 415 ? '请求格式无效' : '请求内容无效',
          requestId,
        },
      });
    }

    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    requestErrors.set(request, { errorCode: 'NOT_FOUND' });
    return reply.code(404).send({
      error: { code: 'NOT_FOUND', message: '请求的内容不存在', requestId: request.id },
    });
  });

  if (ownsPrisma) {
    app.addHook('onClose', async () => prisma.$disconnect());
  }

  return app;
}
