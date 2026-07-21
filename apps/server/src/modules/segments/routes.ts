import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  getPaginationErrorMessages,
  paginationQuerySchema,
  segmentCreateSchema,
  segmentIdParamsSchema,
  segmentListQuerySchema,
  segmentPreviewRequestSchema,
  segmentUpdateSchema,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import { SegmentService } from './service.js';

export function registerSegmentRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  now?: () => Date,
): void {
  const service = new SegmentService(prisma, now);

  app.get('/api/segments', async (request) => {
    const query = segmentListQuerySchema.safeParse(request.query);
    if (!query.success) {
      const messages = getPaginationErrorMessages(query.error.issues);
      if (query.error.issues.some((issue) => issue.path[0] === 'q')) {
        messages.push('搜索词最多 100 个字符');
      }
      throw new ApiError(
        400,
        'BAD_REQUEST',
        messages.length > 0 ? messages.join('；') : '请检查搜索词和分页条件',
      );
    }
    return service.list(query.data);
  });

  app.get('/api/segments/:id/usages', async (request) => {
    const params = segmentIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '分群链接无效');

    const query = paginationQuerySchema.safeParse(request.query);
    if (!query.success) {
      const messages = getPaginationErrorMessages(query.error.issues);
      throw new ApiError(
        400,
        'BAD_REQUEST',
        messages.length > 0 ? messages.join('；') : '请检查分页条件',
      );
    }
    return service.usages(params.data.id, query.data);
  });

  app.post('/api/segments/preview', async (request) => {
    const input = segmentPreviewRequestSchema.safeParse(request.body);
    if (!input.success) {
      throw new ApiError(400, 'BAD_REQUEST', '请检查计算条件');
    }
    if ('rules' in input.data) {
      return { data: await service.preview(input.data.rules) };
    }
    return { data: await service.refresh(input.data.segmentId, input.data.revision) };
  });

  app.get('/api/segments/:id', async (request) => {
    const params = segmentIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '分群链接无效');

    const segment = await service.get(params.data.id);
    if (segment === null) throw new ApiError(404, 'NOT_FOUND', '分群不存在');
    return { data: segment };
  });

  app.post('/api/segments', async (request, reply) => {
    const input = segmentCreateSchema.safeParse(request.body);
    if (!input.success) {
      throw new ApiError(400, 'BAD_REQUEST', '请检查分群名称、说明和规则');
    }

    const segment = await service.create(input.data, request.currentAccount!.id);
    return reply.code(201).send({ data: segment });
  });

  app.patch('/api/segments/:id', async (request) => {
    const params = segmentIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '分群链接无效');

    const input = segmentUpdateSchema.safeParse(request.body);
    if (!input.success) {
      throw new ApiError(400, 'BAD_REQUEST', '请检查分群名称、说明、规则和修订号');
    }

    const segment = await service.update(params.data.id, input.data, request.currentAccount!.id);
    return { data: segment };
  });

  app.delete('/api/segments/:id', async (request, reply) => {
    const params = segmentIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '分群链接无效');

    const deleted = await service.delete(params.data.id);
    if (!deleted) throw new ApiError(404, 'NOT_FOUND', '分群不存在');
    return reply.code(204).send();
  });
}
