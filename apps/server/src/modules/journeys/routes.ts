import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import {
  campaignJourneyParamsSchema,
  getJourneyDraftWarnings,
  getPaginationErrorMessages,
  journeyAiDraftRequestSchema,
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
  isJourneyMessageVariableError,
} from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import { AiDraftService, type AiDraftServiceDeps } from './ai-draft-service.js';
import { JourneyService } from './service.js';
import { JourneyVersionService } from './version-service.js';

/** 生成请求只包含描述和成对补答，单独限制请求体大小，其余接口沿用原约定。 */
const AI_DRAFT_BODY_LIMIT_BYTES = 16 * 1024;

export function registerJourneyRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  now?: () => Date,
  aiDraftDeps?: AiDraftServiceDeps,
): void {
  const service = new JourneyService(prisma);
  const versionService = new JourneyVersionService(prisma, now);
  // 未配置模型时不创建服务：接口明确提示暂不可用，手工编排不受影响。
  const aiDraftService =
    aiDraftDeps === undefined ? undefined : new AiDraftService(prisma, aiDraftDeps);

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
      // 变量语法错误给出具体原因；其他草稿错误保持原有提示。
      const variableIssue = input.error.issues.find(
        (issue) =>
          (issue.path.at(-1) === 'subject' || issue.path.at(-1) === 'body') &&
          isJourneyMessageVariableError(issue.message),
      );
      throw new ApiError(
        400,
        'JOURNEY_DRAFT_INVALID',
        variableIssue?.message ?? '旅程草稿内容无效，请检查节点设置和连线',
      );
    }

    const journey = await service.saveDraft(params.data.id, input.data, request.currentAccount!.id);
    return { data: journey };
  });

  // AI 起草：一次点击最多一次模型调用，结果不写业务表，应用仍走原有草稿保存接口。
  app.post(
    '/api/journeys/:id/ai-draft',
    { bodyLimit: AI_DRAFT_BODY_LIMIT_BYTES },
    async (request) => {
      const params = journeyIdParamsSchema.safeParse(request.params);
      if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '旅程链接无效');

      const input = journeyAiDraftRequestSchema.safeParse(request.body);
      if (!input.success) {
        // 成对补答不符合题目要求时，提示运营检查已选内容
        const clarificationInvalid = input.error.issues.some(
          (issue) => issue.path[0] === 'clarifications',
        );
        throw new ApiError(
          400,
          'BAD_REQUEST',
          clarificationInvalid
            ? '请填写完整的补充信息，并检查所选内容'
            : '请选择有效的进入行为，并填写有效的旅程描述',
        );
      }
      if (aiDraftService === undefined) {
        throw new ApiError(503, 'AI_DRAFT_UNAVAILABLE', 'AI 起草暂不可用，请稍后再试');
      }

      const result = await aiDraftService.generate(
        params.data.id,
        input.data,
        request.currentAccount!.id,
        request.log,
      );
      return { data: result };
    },
  );

  app.post('/api/journeys/:id/simulate', async (request) => {
    const params = journeyIdParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError(400, 'BAD_REQUEST', '旅程链接无效');

    const input = journeySimulationRequestSchema.safeParse(request.body);
    if (!input.success)
      throw new ApiError(400, 'BAD_REQUEST', '请检查模拟资料、行为内容和步骤设置');
    const warnings = getJourneyDraftWarnings(input.data.draftDefinition);
    if (warnings.length > 0) {
      // 商品变量来源问题要说明具体原因；其他未完成流程仍沿用原提示。
      const productWarning = warnings.find(
        (warning) => warning.code === 'message-product-unavailable',
      );
      throw new ApiError(
        400,
        'JOURNEY_DRAFT_INCOMPLETE',
        productWarning?.message ?? '请先补齐流程连接',
      );
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
