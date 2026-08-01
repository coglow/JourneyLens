import {
  eventDetailResponseSchema,
  eventExecutionListQuerySchema,
  eventExecutionListResponseSchema,
  eventIdParamsSchema,
  eventListQuerySchema,
  eventListResponseSchema,
  getEventListErrorMessages,
  getPaginationErrorMessages,
  type EventExecutionListQueryInput,
  type EventListQueryInput,
} from '@journeylens/shared';
import { ApiError, request } from './api';

function toEventListParams(query: ReturnType<typeof eventListQuerySchema.parse>) {
  const params: Record<string, string | number> = {};
  if (query.q) params.q = query.q;
  if (query.type) params.type = query.type;
  if (query.receivedFrom) params.receivedFrom = query.receivedFrom;
  if (query.receivedTo) params.receivedTo = query.receivedTo;
  if (query.eventId) params.eventId = query.eventId;
  if (query.page !== 1) params.page = query.page;
  if (query.pageSize !== 10) params.pageSize = query.pageSize;
  return params;
}

export async function getEvents(input: EventListQueryInput = {}, signal?: AbortSignal) {
  const result = eventListQuerySchema.safeParse(input);
  if (!result.success) {
    const messages = [
      ...getPaginationErrorMessages(result.error.issues),
      ...getEventListErrorMessages(result.error.issues),
    ];
    throw new ApiError(
      undefined,
      'BAD_REQUEST',
      [...new Set(messages)].join('；') || '请检查查询条件',
    );
  }

  return request(
    {
      url: '/events',
      method: 'GET',
      params: toEventListParams(result.data),
      ...(signal ? { signal } : {}),
    },
    eventListResponseSchema,
  );
}

export async function getEvent(id: string, signal?: AbortSignal) {
  if (!eventIdParamsSchema.safeParse({ id }).success) {
    throw new ApiError(undefined, 'BAD_REQUEST', '行为ID格式不正确，请检查后重试');
  }
  const body = await request(
    {
      url: `/events/${encodeURIComponent(id)}`,
      method: 'GET',
      ...(signal ? { signal } : {}),
    },
    eventDetailResponseSchema,
  );
  return body.data;
}

export async function getEventExecutions(
  id: string,
  input: EventExecutionListQueryInput = {},
  signal?: AbortSignal,
) {
  if (!eventIdParamsSchema.safeParse({ id }).success) {
    throw new ApiError(undefined, 'BAD_REQUEST', '行为ID格式不正确，请检查后重试');
  }
  const result = eventExecutionListQuerySchema.safeParse(input);
  if (!result.success) {
    const messages = getPaginationErrorMessages(result.error.issues);
    throw new ApiError(
      undefined,
      'BAD_REQUEST',
      [...new Set(messages)].join('；') || '请检查查询条件',
    );
  }

  const params: Record<string, string | number> = {};
  if (result.data.page !== 1) params.page = result.data.page;
  if (result.data.pageSize !== 10) params.pageSize = result.data.pageSize;

  return request(
    {
      url: `/events/${encodeURIComponent(id)}/executions`,
      method: 'GET',
      params,
      ...(signal ? { signal } : {}),
    },
    eventExecutionListResponseSchema,
  );
}
