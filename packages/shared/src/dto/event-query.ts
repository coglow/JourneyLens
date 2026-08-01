import { z } from 'zod';
import { JOURNEY_EVENT_TYPES } from '../journeys/journey-events.js';
import { eventSummarySchema } from './event.js';
import {
  EXECUTION_STATUSES,
  executionAudienceRefSchema,
  executionCampaignRefSchema,
  executionJourneyRefSchema,
  executionVersionRefSchema,
} from './execution.js';
import { paginatedListSchema, paginationQuerySchema } from './pagination.js';

export const EVENT_SEARCH_MAX_LENGTH = 100;

const eventTypeSchema = z.enum(JOURNEY_EVENT_TYPES);
const eventIdSchema = z.uuid({ error: '行为ID格式不正确，请检查后重试' });
const eventTimeSchema = z.iso.datetime();

/** 行为列表筛选只描述已保存记录；时间边界包含在查询范围内。 */
export const eventListQuerySchema = z
  .object({
    ...paginationQuerySchema.shape,
    q: z
      .string()
      .trim()
      .max(EVENT_SEARCH_MAX_LENGTH, `搜索词最多 ${EVENT_SEARCH_MAX_LENGTH} 个字符`)
      .transform((value) => value || undefined)
      .optional(),
    type: eventTypeSchema.optional(),
    receivedFrom: eventTimeSchema.optional(),
    receivedTo: eventTimeSchema.optional(),
    eventId: eventIdSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.receivedFrom !== undefined &&
      value.receivedTo !== undefined &&
      Date.parse(value.receivedFrom) > Date.parse(value.receivedTo)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['receivedFrom'],
        message: '接收时间范围无效，开始时间不能晚于结束时间',
      });
    }
  });

export const eventIdParamsSchema = z.object({ id: eventIdSchema }).strict();

export const eventListItemSchema = z
  .object({
    id: z.uuid(),
    type: eventTypeSchema,
    receivedAt: eventTimeSchema,
    audience: executionAudienceRefSchema,
  })
  .strict();

export const eventListResponseSchema = paginatedListSchema(eventListItemSchema);

export const eventDetailSchema = eventSummarySchema.extend({
  audience: executionAudienceRefSchema,
});

export const eventDetailResponseSchema = z.object({ data: eventDetailSchema }).strict();

export const eventExecutionListQuerySchema = paginationQuerySchema;

export const eventRelatedExecutionSchema = z
  .object({
    id: z.uuid(),
    campaign: executionCampaignRefSchema,
    journey: executionJourneyRefSchema,
    version: executionVersionRefSchema,
    status: z.enum(EXECUTION_STATUSES),
    startedAt: eventTimeSchema,
    enteredByEvent: z.boolean(),
    matchedStep: z
      .object({
        nodeId: z.string().min(1).max(64),
        nodeName: z.string().min(1).max(120),
        endedWaitingAt: eventTimeSchema.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const eventExecutionListResponseSchema = paginatedListSchema(eventRelatedExecutionSchema);

export function getEventListErrorMessages(issues: readonly { path: PropertyKey[] }[]): string[] {
  const messages: string[] = [];
  if (issues.some((issue) => issue.path[0] === 'q')) {
    messages.push(`搜索词最多 ${EVENT_SEARCH_MAX_LENGTH} 个字符`);
  }
  if (issues.some((issue) => issue.path[0] === 'type')) {
    messages.push('行为类型无效，请重新选择');
  }
  if (issues.some((issue) => ['receivedFrom', 'receivedTo'].includes(String(issue.path[0])))) {
    messages.push('接收时间范围无效，请检查后重试');
  }
  if (issues.some((issue) => issue.path[0] === 'eventId')) {
    messages.push('行为ID格式不正确，请检查后重试');
  }
  return messages;
}

export type EventListQuery = z.output<typeof eventListQuerySchema>;
export type EventListQueryInput = z.input<typeof eventListQuerySchema>;
export type EventListItem = z.infer<typeof eventListItemSchema>;
export type EventDetail = z.infer<typeof eventDetailSchema>;
export type EventExecutionListQuery = z.output<typeof eventExecutionListQuerySchema>;
export type EventExecutionListQueryInput = z.input<typeof eventExecutionListQuerySchema>;
export type EventRelatedExecution = z.infer<typeof eventRelatedExecutionSchema>;
