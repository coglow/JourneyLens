import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AuthService } from './auth/auth-service.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerSessionGuard } from './auth/session-plugin.js';
import { createPrismaClient } from './db/client.js';
import { ApiError } from './errors.js';
import { registerRequestSecurity } from './security.js';

export interface BuildAppOptions {
  prisma?: PrismaClient;
  verifyPassword?: (hash: string, password: string) => Promise<boolean>;
  now?: () => Date;
}

export function buildApp(options: BuildAppOptions = {}) {
  const databaseUrl = process.env.DATABASE_URL;
  if (options.prisma === undefined && !databaseUrl) {
    throw new Error('DATABASE_URL 未设置，请检查根目录 .env');
  }
  const ownsPrisma = options.prisma === undefined;
  const prisma = options.prisma ?? createPrismaClient(databaseUrl!);
  const app = Fastify();

  app.register(cookie);
  registerRequestSecurity(app);

  const service = new AuthService({
    prisma,
    verifyPassword: options.verifyPassword,
    now: options.now,
  });
  registerSessionGuard(app, service);
  registerAuthRoutes(app, { service, now: options.now });

  app.get('/health/live', async () => ({ status: 'ok' as const }));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      if (error.retryAfterSeconds !== undefined) {
        reply.header('Retry-After', String(error.retryAfterSeconds));
      }
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
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
        },
      });
    }

    request.log.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'API 请求失败',
    );
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' },
    });
  });

  if (ownsPrisma) {
    app.addHook('onClose', async () => prisma.$disconnect());
  }

  return app;
}
