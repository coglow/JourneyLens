import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  campaignJourneyParamsSchema,
  getJourneyDraftWarnings,
  getPaginationErrorMessages,
  journeyCreateSchema,
  journeyDraftSaveSchema,
  journeyIdParamsSchema,
  journeyListQuerySchema,
  journeySimulationRequestSchema,
  journeyUpdateSchema,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import { JourneyService } from './service.js';

export function registerJourneyRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const service = new JourneyService(prisma);

  app.get('/api/campaigns/:campaignId/journeys', async (request) => {
    const params = campaignJourneyParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '活动链接无效');

    const query = journeyListQuerySchema.safeParse(request.query);
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
    return service.listByCampaign(params.data.campaignId, query.data);
  });

  app.post('/api/campaigns/:campaignId/journeys', async (request, reply) => {
    const params = campaignJourneyParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '活动链接无效');

    const input = journeyCreateSchema.safeParse(request.body);
    if (!input.success) {
      throw new ApiError(400, 'BAD_REQUEST', '请检查旅程名称、说明和入口分群');
    }

    const journey = await service.create(
      params.data.campaignId,
      input.data,
      request.currentAccount!.id,
    );
    return reply.code(201).send({ data: journey });
  });

  app.get('/api/journeys/:id', async (request) => {
    const params = journeyIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '旅程链接无效');

    const journey = await service.get(params.data.id);
    if (journey === null) throw new ApiError(404, 'NOT_FOUND', '旅程不存在');
    return { data: journey };
  });

  app.patch('/api/journeys/:id', async (request) => {
    const params = journeyIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '旅程链接无效');

    const input = journeyUpdateSchema.safeParse(request.body);
    if (!input.success) {
      throw new ApiError(400, 'BAD_REQUEST', '请检查旅程名称、说明、入口分群和修订号');
    }

    const journey = await service.update(params.data.id, input.data, request.currentAccount!.id);
    return { data: journey };
  });

  app.put('/api/journeys/:id/draft', async (request) => {
    const params = journeyIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '旅程链接无效');

    const input = journeyDraftSaveSchema.safeParse(request.body);
    if (!input.success) {
      throw new ApiError(400, 'JOURNEY_DRAFT_INVALID', '旅程草稿内容无效，请检查节点设置和连线');
    }

    const journey = await service.saveDraft(params.data.id, input.data, request.currentAccount!.id);
    return { data: journey };
  });

  app.post('/api/journeys/:id/simulate', async (request) => {
    const params = journeyIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '旅程链接无效');

    const input = journeySimulationRequestSchema.safeParse(request.body);
    if (!input.success)
      throw new ApiError(400, 'BAD_REQUEST', '请检查模拟资料、行为内容和步骤设置');
    if (getJourneyDraftWarnings(input.data.draftDefinition).length > 0) {
      throw new ApiError(400, 'JOURNEY_DRAFT_INCOMPLETE', '请先补齐流程连接');
    }

    return { data: await service.simulate(params.data.id, input.data) };
  });

  app.delete('/api/journeys/:id', async (request, reply) => {
    const params = journeyIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '旅程链接无效');

    await service.delete(params.data.id);
    return reply.code(204).send();
  });
}
