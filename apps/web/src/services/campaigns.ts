import {
  campaignCreateSchema,
  campaignDetailResponseSchema,
  campaignListQuerySchema,
  campaignListResponseSchema,
  campaignOverviewResponseSchema,
  campaignUpdateSchema,
  getPaginationErrorMessages,
  type CampaignCreateInput,
  type CampaignListQueryInput,
  type CampaignOverview,
  type CampaignUpdateInput,
} from '@journeylens/shared';
import { ApiError, request, requestVoid } from './api';

export async function getCampaigns(input: CampaignListQueryInput = {}, signal?: AbortSignal) {
  const result = campaignListQuerySchema.safeParse(input);
  if (!result.success) {
    const messages = getPaginationErrorMessages(result.error.issues);
    throw new ApiError(
      undefined,
      'BAD_REQUEST',
      messages.length > 0 ? messages.join('；') : '请检查搜索词和活动状态',
    );
  }

  const query = result.data;
  const params: Record<string, string | number> = {};
  if (query.q) params.q = query.q;
  if (query.status) params.status = query.status;
  if (query.page !== 1) params.page = query.page;
  if (query.pageSize !== 10) params.pageSize = query.pageSize;

  return request(
    { url: '/campaigns', method: 'GET', params, ...(signal ? { signal } : {}) },
    campaignListResponseSchema,
  );
}

export async function createCampaign(input: CampaignCreateInput) {
  const payload = campaignCreateSchema.parse(input);
  const body = await request(
    { url: '/campaigns', method: 'POST', data: payload },
    campaignDetailResponseSchema,
  );
  return body.data;
}

export async function getCampaign(id: string, signal?: AbortSignal) {
  const body = await request(
    { url: `/campaigns/${encodeURIComponent(id)}`, method: 'GET', ...(signal ? { signal } : {}) },
    campaignDetailResponseSchema,
  );
  return body.data;
}

export async function getCampaignOverview(
  id: string,
  signal?: AbortSignal,
): Promise<CampaignOverview> {
  const body = await request(
    {
      url: `/campaigns/${encodeURIComponent(id)}/overview`,
      method: 'GET',
      ...(signal ? { signal } : {}),
    },
    campaignOverviewResponseSchema,
  );
  return body.data;
}

export async function updateCampaign(id: string, input: CampaignUpdateInput) {
  const payload = campaignUpdateSchema.parse(input);
  const body = await request(
    { url: `/campaigns/${encodeURIComponent(id)}`, method: 'PATCH', data: payload },
    campaignDetailResponseSchema,
  );
  return body.data;
}

export async function deleteCampaign(id: string): Promise<void> {
  await requestVoid({ url: `/campaigns/${encodeURIComponent(id)}`, method: 'DELETE' });
}

export type CampaignTransition = 'start' | 'pause' | 'resume' | 'stop';

export async function transitionCampaign(id: string, action: CampaignTransition) {
  const body = await request(
    { url: `/campaigns/${encodeURIComponent(id)}/${action}`, method: 'POST', data: {} },
    campaignDetailResponseSchema,
  );
  return body.data;
}
