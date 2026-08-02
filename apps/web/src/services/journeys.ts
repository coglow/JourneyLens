import {
  getPaginationErrorMessages,
  journeyCreateSchema,
  journeyDetailResponseSchema,
  journeyDraftSaveSchema,
  journeyListQuerySchema,
  journeyListResponseSchema,
  journeySimulationRequestSchema,
  journeySimulationResponseSchema,
  journeyStatsListQuerySchema,
  journeyStatsListResponseSchema,
  journeyUpdateSchema,
  journeyVersionDetailResponseSchema,
  journeyVersionListQuerySchema,
  journeyVersionListResponseSchema,
  journeyVersionPublishSchema,
  journeyVersionStatsResponseSchema,
  type JourneyCreateInput,
  type JourneyDraftDefinition,
  type JourneyListQueryInput,
  type JourneySimulationInput,
  type JourneyStatsListQueryInput,
  type JourneyUpdateInput,
  type JourneyVersionPublishInput,
  type PaginationQueryInput,
} from '@journeylens/shared';
import { ApiError, request, requestVoid } from './api';

export async function getJourneys(
  campaignId: string,
  input: JourneyListQueryInput = {},
  signal?: AbortSignal,
) {
  const result = journeyListQuerySchema.safeParse(input);
  if (!result.success) {
    const messages = getPaginationErrorMessages(result.error.issues);
    if (result.error.issues.some((issue) => issue.path[0] === 'q')) {
      messages.push('搜索词最多 100 个字符');
    }
    throw new ApiError(undefined, 'BAD_REQUEST', messages.join('；') || '请检查搜索词和分页条件');
  }

  const query = result.data;
  const params: Record<string, string | number> = {};
  if (query.q) params.q = query.q;
  if (query.page !== 1) params.page = query.page;
  if (query.pageSize !== 10) params.pageSize = query.pageSize;

  return request(
    {
      url: `/campaigns/${encodeURIComponent(campaignId)}/journeys`,
      method: 'GET',
      params,
      ...(signal ? { signal } : {}),
    },
    journeyListResponseSchema,
  );
}

/** 旅程统计入口：跨活动读取有发布版本的旅程，最新版本由服务端按版本号给出。 */
export async function getJourneyStatsList(
  input: JourneyStatsListQueryInput = {},
  signal?: AbortSignal,
) {
  const result = journeyStatsListQuerySchema.safeParse(input);
  if (!result.success) {
    const messages = getPaginationErrorMessages(result.error.issues);
    if (result.error.issues.some((issue) => issue.path[0] === 'q')) {
      messages.push('搜索词最多 100 个字符');
    }
    if (result.error.issues.some((issue) => issue.path[0] === 'campaignId')) {
      messages.push('请选择有效的活动');
    }
    throw new ApiError(
      undefined,
      'BAD_REQUEST',
      messages.length > 0 ? messages.join('；') : '请检查搜索词、活动和分页条件',
    );
  }

  const query = result.data;
  const params: Record<string, string | number> = {};
  if (query.q) params.q = query.q;
  if (query.campaignId) params.campaignId = query.campaignId;
  if (query.page !== 1) params.page = query.page;
  if (query.pageSize !== 10) params.pageSize = query.pageSize;

  return request(
    {
      url: '/journey-stats',
      method: 'GET',
      params,
      ...(signal ? { signal } : {}),
    },
    journeyStatsListResponseSchema,
  );
}

export async function createJourney(campaignId: string, input: JourneyCreateInput) {
  const payload = journeyCreateSchema.parse(input);
  const body = await request(
    { url: `/campaigns/${encodeURIComponent(campaignId)}/journeys`, method: 'POST', data: payload },
    journeyDetailResponseSchema,
  );
  return body.data;
}

export async function getJourney(id: string, signal?: AbortSignal) {
  const body = await request(
    { url: `/journeys/${encodeURIComponent(id)}`, method: 'GET', ...(signal ? { signal } : {}) },
    journeyDetailResponseSchema,
  );
  return body.data;
}

export async function updateJourney(id: string, input: JourneyUpdateInput) {
  const payload = journeyUpdateSchema.parse(input);
  const body = await request(
    { url: `/journeys/${encodeURIComponent(id)}`, method: 'PATCH', data: payload },
    journeyDetailResponseSchema,
  );
  return body.data;
}

export async function saveJourneyDraft(
  id: string,
  input: { revision: number; draftDefinition: JourneyDraftDefinition },
) {
  const payload = journeyDraftSaveSchema.parse(input);
  const body = await request(
    { url: `/journeys/${encodeURIComponent(id)}/draft`, method: 'PUT', data: payload },
    journeyDetailResponseSchema,
  );
  return body.data;
}

export async function deleteJourney(id: string): Promise<void> {
  await requestVoid({ url: `/journeys/${encodeURIComponent(id)}`, method: 'DELETE' });
}

/** 发布版本：只提交已保存内容的两个修订号，快照由服务端构造。 */
export async function publishJourney(id: string, input: JourneyVersionPublishInput) {
  const payload = journeyVersionPublishSchema.parse(input);
  const body = await request(
    {
      url: `/journeys/${encodeURIComponent(id)}/publish`,
      method: 'POST',
      data: payload,
    },
    journeyVersionDetailResponseSchema,
  );
  return body.data;
}

export async function getJourneyVersions(
  id: string,
  input: PaginationQueryInput = {},
  signal?: AbortSignal,
) {
  const result = journeyVersionListQuerySchema.safeParse(input);
  if (!result.success) {
    const messages = getPaginationErrorMessages(result.error.issues);
    throw new ApiError(undefined, 'BAD_REQUEST', messages.join('；') || '请检查分页条件');
  }

  const query = result.data;
  const params: Record<string, string | number> = {};
  if (query.page !== 1) params.page = query.page;
  if (query.pageSize !== 10) params.pageSize = query.pageSize;

  return request(
    {
      url: `/journeys/${encodeURIComponent(id)}/versions`,
      method: 'GET',
      params,
      ...(signal ? { signal } : {}),
    },
    journeyVersionListResponseSchema,
  );
}

export async function getJourneyVersion(id: string, versionId: string, signal?: AbortSignal) {
  const body = await request(
    {
      url: `/journeys/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`,
      method: 'GET',
      ...(signal ? { signal } : {}),
    },
    journeyVersionDetailResponseSchema,
  );
  return body.data;
}

export async function getJourneyVersionStats(id: string, versionId: string, signal?: AbortSignal) {
  const body = await request(
    {
      url: `/journeys/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/stats`,
      method: 'GET',
      ...(signal ? { signal } : {}),
    },
    journeyVersionStatsResponseSchema,
  );
  return body.data;
}

/** 单次模拟：提交点击时的画布与资料副本，不保存草稿或用户资料。 */
export async function simulateJourney(journeyId: string, input: JourneySimulationInput) {
  const payload = journeySimulationRequestSchema.parse(input);
  const body = await request(
    {
      url: `/journeys/${encodeURIComponent(journeyId)}/simulate`,
      method: 'POST',
      data: payload,
    },
    journeySimulationResponseSchema,
  );
  return body.data;
}
