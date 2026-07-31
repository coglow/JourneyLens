import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  executionIdParamsSchema,
  executionListQuerySchema,
  getExecutionListErrorMessages,
  getPaginationErrorMessages,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import { ExecutionService } from './service.js';

export function registerExecutionRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const service = new ExecutionService(prisma);

  app.get('/api/executions', async (request) => {
    const query = executionListQuerySchema.safeParse(request.query);
    if (!query.success) {
      const messages = [
        ...getPaginationErrorMessages(query.error.issues),
        ...getExecutionListErrorMessages(query.error.issues),
      ];
      throw new ApiError(
        400,
        'BAD_REQUEST',
        [...new Set(messages)].join('；') || '请检查筛选条件和分页条件',
      );
    }
    return service.list(query.data);
  });

  app.get('/api/executions/:id/trace', async (request) => {
    const params = executionIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '执行记录链接无效');

    return { data: await service.getTrace(params.data.id) };
  });
}
