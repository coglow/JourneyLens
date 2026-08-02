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
  journeyStatsListQuerySchema,
  journeyUpdateSchema,
  journeyVersionListQuerySchema,
  journeyVersionParamsSchema,
  journeyVersionPublishSchema,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import { JourneyService } from './service.js';
import { JourneyVersionService } from './version-service.js';

export function registerJourneyRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  now?: () => Date,
): void {
  const service = new JourneyService(prisma);
  const versionService = new JourneyVersionService(prisma, now);

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

  // 旅程统计入口：跨活动列出已有发布版本的旅程，只读，不改变任何旅程状态。
  app.get('/api/journey-stats', async (request) => {
    const query = journeyStatsListQuerySchema.safeParse(request.query);
    if (!query.success) {
      const messages = getPaginationErrorMessages(query.error.issues);
      if (query.error.issues.some((issue) => issue.path[0] === 'q')) {
        messages.push('搜索词最多 100 个字符');
      }
      if (query.error.issues.some((issue) => issue.path[0] === 'campaignId')) {
        messages.push('请选择有效的活动');
      }
      throw new ApiError(
        400,
        'BAD_REQUEST',
        messages.length > 0 ? messages.join('；') : '请检查搜索词、活动和分页条件',
      );
    }
    return service.listWithPublishedVersions(query.data);
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

  app.post('/api/journeys/:id/publish', async (request, reply) => {
    const params = journeyIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '旅程链接无效');

    const input = journeyVersionPublishSchema.safeParse(request.body);
    if (!input.success) {
      throw new ApiError(400, 'BAD_REQUEST', '请检查旅程修订号和分群修订号');
    }

    const result = await versionService.publish(
      params.data.id,
      input.data,
      request.currentAccount!.id,
    );
    // 命中已有版本时返回 200，新建版本返回 201；两者对使用者都表示发布成功。
    return reply.code(result.created ? 201 : 200).send({ data: result.version });
  });

  app.get('/api/journeys/:id/versions', async (request) => {
    const params = journeyIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '旅程链接无效');

    const query = journeyVersionListQuerySchema.safeParse(request.query);
    if (!query.success) {
      const messages = getPaginationErrorMessages(query.error.issues);
      throw new ApiError(
        400,
        'BAD_REQUEST',
        messages.length > 0 ? messages.join('；') : '请检查分页条件',
      );
    }
    return versionService.list(params.data.id, query.data);
  });

  app.get('/api/journeys/:id/versions/:versionId', async (request) => {
    const params = journeyVersionParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '版本链接无效');

    return { data: await versionService.get(params.data.id, params.data.versionId) };
  });

  app.get('/api/journeys/:id/versions/:versionId/stats', async (request) => {
    const params = journeyVersionParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '版本链接无效');

    return { data: await versionService.getStats(params.data.id, params.data.versionId) };
  });

  app.delete('/api/journeys/:id', async (request, reply) => {
    const params = journeyIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '旅程链接无效');

    await service.delete(params.data.id);
    return reply.code(204).send();
  });
}
