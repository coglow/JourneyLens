import {
  segmentCreateSchema,
  segmentDetailResponseSchema,
  segmentListQuerySchema,
  segmentListResponseSchema,
  segmentPreviewResponseSchema,
  segmentRefreshPreviewResponseSchema,
  segmentUpdateSchema,
  type SegmentCreateInput,
  type SegmentListQueryInput,
  type SegmentRule,
  type SegmentUpdateInput,
} from '@journeylens/shared';
import { ApiError, request, requestVoid } from './api';

export async function getSegments(input: SegmentListQueryInput = {}, signal?: AbortSignal) {
  const result = segmentListQuerySchema.safeParse(input);
  if (!result.success) {
    const messages: string[] = [];
    if (result.error.issues.some((issue) => issue.path[0] === 'page')) {
      messages.push('页码必须是正整数');
    }
    if (result.error.issues.some((issue) => issue.path[0] === 'pageSize')) {
      messages.push('每页条数只能选择 10、20 或 50 条');
    }
    if (result.error.issues.some((issue) => issue.path[0] === 'q')) {
      messages.push('搜索词最多 100 个字符');
    }
    throw new ApiError(
      undefined,
      'BAD_REQUEST',
      messages.length > 0 ? messages.join('；') : '请检查搜索词和分页条件',
    );
  }

  const query = result.data;
  const params: Record<string, string | number> = {};
  if (query.q) params.q = query.q;
  if (query.page !== 1) params.page = query.page;
  if (query.pageSize !== 10) params.pageSize = query.pageSize;

  return request(
    { url: '/segments', method: 'GET', params, ...(signal ? { signal } : {}) },
    segmentListResponseSchema,
  );
}

export async function createSegment(input: SegmentCreateInput) {
  const payload = segmentCreateSchema.parse(input);
  const body = await request(
    { url: '/segments', method: 'POST', data: payload },
    segmentDetailResponseSchema,
  );
  return body.data;
}

export async function getSegment(id: string, signal?: AbortSignal) {
  const body = await request(
    { url: `/segments/${encodeURIComponent(id)}`, method: 'GET', ...(signal ? { signal } : {}) },
    segmentDetailResponseSchema,
  );
  return body.data;
}

export async function updateSegment(id: string, input: SegmentUpdateInput) {
  const payload = segmentUpdateSchema.parse(input);
  const body = await request(
    { url: `/segments/${encodeURIComponent(id)}`, method: 'PATCH', data: payload },
    segmentDetailResponseSchema,
  );
  return body.data;
}

export async function deleteSegment(id: string): Promise<void> {
  await requestVoid({ url: `/segments/${encodeURIComponent(id)}`, method: 'DELETE' });
}

export async function previewSegmentRules(rules: SegmentRule, signal?: AbortSignal) {
  const body = await request(
    {
      url: '/segments/preview',
      method: 'POST',
      data: { rules },
      ...(signal ? { signal } : {}),
    },
    segmentPreviewResponseSchema,
  );
  return body.data;
}

export async function refreshSegmentEstimate(segmentId: string, revision: number) {
  const body = await request(
    { url: '/segments/preview', method: 'POST', data: { segmentId, revision } },
    segmentRefreshPreviewResponseSchema,
  );
  return body.data;
}
