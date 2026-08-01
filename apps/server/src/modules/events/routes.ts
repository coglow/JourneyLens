import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  eventExecutionListQuerySchema,
  eventIdParamsSchema,
  eventIngestSchema,
  eventListQuerySchema,
  getEventListErrorMessages,
  getPaginationErrorMessages,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import { EventService } from './service.js';

export function registerEventRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  now?: () => Date,
): void {
  const service = new EventService(prisma, now);

  app.get('/api/events', async (request) => {
    const input = eventListQuerySchema.safeParse(request.query);
    if (!input.success) {
      const messages = [
        ...getPaginationErrorMessages(input.error.issues),
        ...getEventListErrorMessages(input.error.issues),
      ];
      throw new ApiError(400, 'BAD_REQUEST', [...new Set(messages)].join('；') || '请检查查询条件');
    }
    return service.list(input.data);
  });

  app.get('/api/events/:id', async (request) => {
    const params = eventIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new ApiError(400, 'BAD_REQUEST', '行为ID格式不正确，请检查后重试');
    }
    return { data: await service.get(params.data.id) };
  });

  app.get('/api/events/:id/executions', async (request) => {
    const params = eventIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new ApiError(400, 'BAD_REQUEST', '行为ID格式不正确，请检查后重试');
    }
    const input = eventExecutionListQuerySchema.safeParse(request.query);
    if (!input.success) {
      const messages = getPaginationErrorMessages(input.error.issues);
      throw new ApiError(400, 'BAD_REQUEST', [...new Set(messages)].join('；') || '请检查查询条件');
    }
    return service.listExecutions(params.data.id, input.data);
  });

  app.post('/api/events/ingest', async (request, reply) => {
    const input = eventIngestSchema.safeParse(request.body);
    if (!input.success) {
      throw new ApiError(
        400,
        'BAD_REQUEST',
        input.error.issues[0]?.message ?? '请检查行为 ID、用户 ID、行为类型和内容',
      );
    }

    const result = await service.ingest(input.data);
    // 首次接收返回 201；同一 ID 同内容的重试返回 200 和原执行ID。
    return reply.code(result.duplicate ? 200 : 201).send({ data: result });
  });
}
