import { z } from 'zod';
import { AUDIENCE_FIELD_KEYS } from '../audience/audience-catalog.js';
import { JOURNEY_MESSAGE_CHANNEL_VALUES, JOURNEY_NODE_TYPES } from '../journeys/journey-draft.js';
import {
  journeyConditionRuleSchema,
  journeyEventFilterSchema,
} from '../journeys/journey-condition.js';
import { JOURNEY_EVENT_TYPES } from '../journeys/journey-events.js';
import { segmentRuleSchema } from '../segments/segment-rule.js';
import { campaignStatusSchema } from './campaign.js';
import { eventPayloadSchema } from './event.js';
import { paginatedListSchema, paginationQuerySchema } from './pagination.js';

export const EXECUTION_STATUSES = ['running', 'waiting', 'completed', 'failed', 'stopped'] as const;

export const EXECUTION_STATUS_LABELS = {
  running: '运行中',
  waiting: '等待中',
  completed: '已完成',
  failed: '失败',
  stopped: '已停止',
} as const satisfies Record<(typeof EXECUTION_STATUSES)[number], string>;

export const EXECUTION_STEP_STATUSES = ['waiting', 'succeeded', 'failed', 'stopped'] as const;

export const EXECUTION_STEP_STATUS_LABELS = {
  waiting: '等待中',
  succeeded: '已完成',
  failed: '失败',
  stopped: '已停止',
} as const satisfies Record<(typeof EXECUTION_STEP_STATUSES)[number], string>;

export const EXECUTION_SEARCH_MAX_LENGTH = 100;
export const EXECUTION_RESULT_MAX_LENGTH = 600;
export const EXECUTION_FAILURE_REASON_MAX_LENGTH = 500;

const executionStatusSchema = z.enum(EXECUTION_STATUSES);
const executionStepStatusSchema = z.enum(EXECUTION_STEP_STATUSES);
const nodeTypeSchema = z.enum(JOURNEY_NODE_TYPES);
const eventTypeSchema = z.enum(JOURNEY_EVENT_TYPES);
const isoDateTimeSchema = z.iso.datetime();
const optionalIsoDateTimeSchema = isoDateTimeSchema.optional();

export const executionListQuerySchema = z
  .object({
    ...paginationQuerySchema.shape,
    campaignId: z.uuid().optional(),
    journeyId: z.uuid().optional(),
    status: executionStatusSchema.optional(),
    q: z
      .string()
      .trim()
      .max(EXECUTION_SEARCH_MAX_LENGTH, `搜索词最多 ${EXECUTION_SEARCH_MAX_LENGTH} 个字符`)
      .transform((value) => value || undefined)
      .optional(),
    createdFrom: optionalIsoDateTimeSchema,
    createdTo: optionalIsoDateTimeSchema,
    endedFrom: optionalIsoDateTimeSchema,
    endedTo: optionalIsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.createdFrom !== undefined &&
      value.createdTo !== undefined &&
      Date.parse(value.createdFrom) > Date.parse(value.createdTo)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['createdFrom'],
        message: '时间范围的起始不能晚于结束',
      });
    }
    if (
      value.endedFrom !== undefined &&
      value.endedTo !== undefined &&
      Date.parse(value.endedFrom) > Date.parse(value.endedTo)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['endedFrom'],
        message: '时间范围的起始不能晚于结束',
      });
    }
  });

export const executionAudienceRefSchema = z
  .object({
    externalId: z.string().min(1).max(160),
    displayName: z.string().min(1).max(120),
  })
  .strict();

export const executionCampaignRefSchema = z
  .object({ id: z.uuid(), name: z.string().min(1).max(180) })
  .strict();

export const executionJourneyRefSchema = z
  .object({ id: z.uuid(), name: z.string().min(1).max(180) })
  .strict();

export const executionVersionRefSchema = z
  .object({ id: z.uuid(), versionNumber: z.number().int().min(1) })
  .strict();

const executionNodeRefSchema = z
  .object({
    nodeId: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    nodeType: nodeTypeSchema,
  })
  .strict();

export const executionListItemSchema = z
  .object({
    id: z.uuid(),
    audience: executionAudienceRefSchema,
    campaign: executionCampaignRefSchema,
    journey: executionJourneyRefSchema,
    version: executionVersionRefSchema,
    status: executionStatusSchema,
    currentStep: executionNodeRefSchema.nullable(),
    result: z.string().max(EXECUTION_RESULT_MAX_LENGTH).nullable(),
    createdAt: isoDateTimeSchema,
    startedAt: isoDateTimeSchema,
    endedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const executionListResponseSchema = paginatedListSchema(executionListItemSchema);

const executionEvidenceValueSchema = z.discriminatedUnion('exists', [
  z.object({ exists: z.literal(false) }).strict(),
  z.object({ exists: z.literal(true), value: z.json() }).strict(),
]);

export const executionConditionEvidenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('value'),
      evaluatedAt: isoDateTimeSchema,
      actual: executionEvidenceValueSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('event_count'),
      evaluatedAt: isoDateTimeSchema,
      windowStartAt: isoDateTimeSchema,
      windowEndAt: isoDateTimeSchema,
      count: z.number().int().min(0),
    })
    .strict(),
]);

/**
 * 步骤输出按节点类型区分，页面据 kind 展示证据。
 * 失败步骤使用 failed 输出，其他步骤保留当次实际产生的配置、判断或演示消息。
 */
export const executionStepOutputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('start'), entryBehavior: eventTypeSchema }).strict(),
  z
    .object({
      kind: z.literal('condition'),
      rule: journeyConditionRuleSchema,
      matched: z.boolean(),
      branch: z.enum(['met', 'unmet']),
      evidence: executionConditionEvidenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('wait'),
      waitSeconds: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('wait_for_event'),
      eventType: eventTypeSchema,
      waitSeconds: z.number().int().min(1),
      filter: journeyEventFilterSchema.optional(),
      sameProduct: z.boolean(),
      outcome: z.enum(['matched', 'timeout']).nullable(),
      matchedEventId: z.uuid().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('message'),
      channel: z.enum(JOURNEY_MESSAGE_CHANNEL_VALUES),
      subject: z.string().max(200).nullable(),
      body: z.string().min(1).max(2_000),
      audienceUserId: z.uuid(),
      demo: z.literal(true),
    })
    .strict(),
  z.object({ kind: z.literal('end'), note: z.string().max(500).nullable() }).strict(),
  z
    .object({
      kind: z.literal('failed'),
      reason: z.string().min(1).max(EXECUTION_FAILURE_REASON_MAX_LENGTH),
    })
    .strict(),
]);

export const executionTraceStepSchema = z
  .object({
    order: z.number().int().min(1),
    nodeId: z.string().min(1).max(64),
    nodeName: z.string().min(1).max(120),
    nodeType: nodeTypeSchema,
    status: executionStepStatusSchema,
    startedAt: isoDateTimeSchema,
    endedAt: isoDateTimeSchema.nullable(),
    deadlineAt: isoDateTimeSchema.nullable(),
    matchedEventId: z.uuid().nullable(),
    failureReason: z.string().max(EXECUTION_FAILURE_REASON_MAX_LENGTH).nullable(),
    output: executionStepOutputSchema,
  })
  .strict();

export const executionEntryEvidenceSchema = z
  .object({
    segment: z
      .object({ name: z.string().min(1).max(160), rules: segmentRuleSchema })
      .strict()
      .nullable(),
    values: z
      .array(
        z
          .object({ field: z.enum(AUDIENCE_FIELD_KEYS), actual: executionEvidenceValueSchema })
          .strict(),
      )
      .max(AUDIENCE_FIELD_KEYS.length),
  })
  .strict();

export const executionTraceSchema = z
  .object({
    id: z.uuid(),
    status: executionStatusSchema,
    currentNode: executionNodeRefSchema.nullable(),
    failureReason: z.string().max(EXECUTION_FAILURE_REASON_MAX_LENGTH).nullable(),
    createdAt: isoDateTimeSchema,
    startedAt: isoDateTimeSchema,
    endedAt: isoDateTimeSchema.nullable(),
    campaign: z
      .object({
        id: z.uuid(),
        name: z.string().min(1).max(180),
        status: campaignStatusSchema,
      })
      .strict(),
    journey: executionJourneyRefSchema,
    version: z
      .object({
        id: z.uuid(),
        versionNumber: z.number().int().min(1),
        publishedAt: isoDateTimeSchema,
      })
      .strict(),
    audience: executionAudienceRefSchema,
    entryEvidence: executionEntryEvidenceSchema,
    triggerEvent: z
      .object({
        id: z.uuid(),
        type: eventTypeSchema,
        receivedAt: isoDateTimeSchema,
        payload: eventPayloadSchema,
      })
      .strict(),
    steps: z.array(executionTraceStepSchema).max(30),
  })
  .strict();

export const executionTraceResponseSchema = z.object({ data: executionTraceSchema }).strict();

export const executionIdParamsSchema = z.object({ id: z.uuid() }).strict();

export function getExecutionListErrorMessages(
  issues: readonly { path: PropertyKey[] }[],
): string[] {
  const messages: string[] = [];
  if (issues.some((issue) => issue.path[0] === 'q')) {
    messages.push(`搜索词最多 ${EXECUTION_SEARCH_MAX_LENGTH} 个字符`);
  }
  if (
    issues.some((issue) =>
      ['createdFrom', 'createdTo', 'endedFrom', 'endedTo'].includes(String(issue.path[0])),
    )
  ) {
    messages.push('时间范围无效，起始时间不能晚于结束时间');
  }
  return messages;
}

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export type ExecutionStepStatus = (typeof EXECUTION_STEP_STATUSES)[number];
export type ExecutionListQuery = z.output<typeof executionListQuerySchema>;
export type ExecutionListQueryInput = z.input<typeof executionListQuerySchema>;
export type ExecutionListItem = z.infer<typeof executionListItemSchema>;
export type ExecutionStepOutput = z.infer<typeof executionStepOutputSchema>;
export type ExecutionTraceStep = z.infer<typeof executionTraceStepSchema>;
export type ExecutionTrace = z.infer<typeof executionTraceSchema>;
