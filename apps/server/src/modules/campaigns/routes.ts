import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  campaignCreateSchema,
  campaignIdParamsSchema,
  campaignListQuerySchema,
  campaignUpdateSchema,
  getPaginationErrorMessages,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import { CampaignService } from './service.js';

export function registerCampaignRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const service = new CampaignService(prisma);

  app.get('/api/campaigns', async (request) => {
    const query = campaignListQuerySchema.safeParse(request.query);
    if (!query.success) {
      const messages = getPaginationErrorMessages(query.error.issues);
      throw new ApiError(
        400,
        'BAD_REQUEST',
        messages.length > 0 ? messages.join('；') : '请检查搜索词、活动状态和分页条件',
      );
    }
    return service.list(query.data);
  });

  app.get('/api/campaigns/:id', async (request) => {
    const params = campaignIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '活动链接无效');

    const campaign = await service.get(params.data.id);
    if (campaign === null) throw new ApiError(404, 'NOT_FOUND', '活动不存在');
    return { data: campaign };
  });

  app.patch('/api/campaigns/:id', async (request) => {
    const params = campaignIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '活动链接无效');

    const input = campaignUpdateSchema.safeParse(request.body);
    if (!input.success) {
      throw new ApiError(400, 'BAD_REQUEST', '请检查活动名称、说明和预算');
    }

    const campaign = await service.update(params.data.id, input.data);
    if (campaign === null) throw new ApiError(404, 'NOT_FOUND', '活动不存在');
    return { data: campaign };
  });

  app.delete('/api/campaigns/:id', async (request, reply) => {
    const params = campaignIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '活动链接无效');

    const deleted = await service.deleteDraft(params.data.id);
    if (!deleted) throw new ApiError(404, 'NOT_FOUND', '活动不存在或已无法删除');
    return reply.code(204).send();
  });

  app.post('/api/campaigns', async (request, reply) => {
    const input = campaignCreateSchema.safeParse(request.body);
    if (!input.success) {
      throw new ApiError(400, 'BAD_REQUEST', '请检查活动名称、说明和预算');
    }

    const result = await service.create(input.data, request.currentAccount!.id);
    return reply.code(201).send({ data: result });
  });
}
