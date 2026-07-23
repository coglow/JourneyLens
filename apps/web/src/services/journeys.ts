import {
  getPaginationErrorMessages,
  journeyCreateSchema,
  journeyDetailResponseSchema,
  journeyListQuerySchema,
  journeyListResponseSchema,
  journeyUpdateSchema,
  type JourneyCreateInput,
  type JourneyListQueryInput,
  type JourneyUpdateInput,
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

export async function deleteJourney(id: string): Promise<void> {
  await requestVoid({ url: `/journeys/${encodeURIComponent(id)}`, method: 'DELETE' });
}
