import {
  executionListQuerySchema,
  executionListResponseSchema,
  executionTraceResponseSchema,
  getExecutionListErrorMessages,
  getPaginationErrorMessages,
  type ExecutionListQueryInput,
} from '@journeylens/shared';
import { ApiError, request } from './api';

function toQueryParams(query: ReturnType<typeof executionListQuerySchema.parse>) {
  const params: Record<string, string | number> = {};
  if (query.campaignId) params.campaignId = query.campaignId;
  if (query.journeyId) params.journeyId = query.journeyId;
  if (query.status) params.status = query.status;
  if (query.q) params.q = query.q;
  if (query.createdFrom) params.createdFrom = query.createdFrom;
  if (query.createdTo) params.createdTo = query.createdTo;
  if (query.endedFrom) params.endedFrom = query.endedFrom;
  if (query.endedTo) params.endedTo = query.endedTo;
  if (query.page !== 1) params.page = query.page;
  if (query.pageSize !== 10) params.pageSize = query.pageSize;
  return params;
}

export async function getExecutions(input: ExecutionListQueryInput = {}, signal?: AbortSignal) {
  const result = executionListQuerySchema.safeParse(input);
  if (!result.success) {
    const messages = [
      ...getPaginationErrorMessages(result.error.issues),
      ...getExecutionListErrorMessages(result.error.issues),
    ];
    throw new ApiError(
      undefined,
      'BAD_REQUEST',
      [...new Set(messages)].join('；') || '请检查筛选条件和分页条件',
    );
  }

  return request(
    {
      url: '/executions',
      method: 'GET',
      params: toQueryParams(result.data),
      ...(signal ? { signal } : {}),
    },
    // 响应结构在接口测试和页面读取时统一校验，避免把错误结构当成列表数据。
    executionListResponseSchema,
  );
}

export async function getExecutionTrace(id: string, signal?: AbortSignal) {
  const body = await request(
    {
      url: `/executions/${encodeURIComponent(id)}/trace`,
      method: 'GET',
      ...(signal ? { signal } : {}),
    },
    executionTraceResponseSchema,
  );
  return body.data;
}
