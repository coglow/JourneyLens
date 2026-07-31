import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { eventIngestSchema } from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import { EventService } from './service.js';

export function registerEventRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  now?: () => Date,
): void {
  const service = new EventService(prisma, now);

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
    // 首次接收返回 201；同一 ID 同内容的重试返回 200 和原执行标识。
    return reply.code(result.duplicate ? 200 : 201).send({ data: result });
  });
}
