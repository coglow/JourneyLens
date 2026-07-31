import { z } from 'zod';
import { AUDIENCE_COLUMN_KEYS, AUDIENCE_FIELDS } from '../audience/audience-catalog.js';
import { journeyDraftDefinitionSchema } from '../journeys/journey-draft.js';
import {
  journeyConditionRuleSchema,
  waitForEventConfigSchema,
  type JourneyConditionRule,
} from '../journeys/journey-condition.js';
import { JOURNEY_EVENT_TYPES, journeyEventField } from '../journeys/journey-events.js';
import { validateFieldValue } from '../journeys/field-value.js';
import { segmentRuleSchema } from '../segments/segment-rule.js';

const NODE_ID_MAX_LENGTH = 64;
const DISPLAY_NAME_MAX_LENGTH = 120;
const SEGMENT_NAME_MAX_LENGTH = 160;
const EVENT_LIMIT = 100;

const jsonRecordSchema = z.record(z.string(), z.json());

const idSchema = z.string().min(1).max(NODE_ID_MAX_LENGTH);
const eventTypeSchema = z.enum(JOURNEY_EVENT_TYPES);
const eventPayloadSchema = jsonRecordSchema;

const simulationUserInputSchema = z
  .object({
    displayName: z
      .string({ error: '昵称必须是文字' })
      .max(DISPLAY_NAME_MAX_LENGTH, `昵称最多 ${DISPLAY_NAME_MAX_LENGTH} 个字符`)
      .nullable(),
    email: z.string({ error: '邮箱必须是文字' }).nullable(),
    attributes: eventPayloadSchema,
  })
  .strict();

const entryEventSchema = z
  .object({
    id: idSchema,
    type: eventTypeSchema,
    offsetSeconds: z.literal(0),
    payload: eventPayloadSchema,
  })
  .strict();

const historicalEventSchema = z
  .object({
    id: idSchema,
    type: eventTypeSchema,
    offsetSeconds: z.number().int().safe().max(-1),
    payload: eventPayloadSchema,
  })
  .strict();

const scheduledEventSchema = z
  .object({
    id: idSchema,
    type: eventTypeSchema,
    offsetSeconds: z.number().int().safe().min(0),
    payload: eventPayloadSchema,
  })
  .strict();

export const journeySimulationScenarioSchema = z
  .object({
    user: simulationUserInputSchema,
    entryEvent: entryEventSchema,
    historicalEvents: z.array(historicalEventSchema).max(EVENT_LIMIT),
    scheduledEvents: z.array(scheduledEventSchema).max(EVENT_LIMIT),
  })
  .strict()
  .superRefine((scenario, ctx) => {
    const userColumnKeys = new Set<string>(AUDIENCE_COLUMN_KEYS);
    for (const [key, value] of Object.entries(scenario.user.attributes)) {
      const field = AUDIENCE_FIELDS.find((item) => item.key === key);
      if (field === undefined || userColumnKeys.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['user', 'attributes', key],
          message: '用户资料包含不支持的属性',
        });
        continue;
      }
      const message = validateFieldValue(field, value);
      if (message !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['user', 'attributes', key], message });
      }
    }

    const allEvents = [
      scenario.entryEvent,
      ...scenario.historicalEvents,
      ...scenario.scheduledEvents,
    ];
    const ids = new Set<string>();
    for (const [index, event] of allEvents.entries()) {
      if (ids.has(event.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['events', index, 'id'],
          message: '行为标识不能重复',
        });
      }
      ids.add(event.id);
      for (const [key, value] of Object.entries(event.payload)) {
        const field = journeyEventField(event.type, key);
        if (field === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['events', index, 'payload', key],
            message: '该行为不支持此属性',
          });
          continue;
        }
        const message = validateFieldValue(field, value);
        if (message !== undefined) {
          ctx.addIssue({ code: 'custom', path: ['events', index, 'payload', key], message });
        }
      }
    }
  });

const entryBehaviorSchema = eventTypeSchema;
export const simulationEvidenceValueSchema = z.discriminatedUnion('exists', [
  z.object({ exists: z.literal(false) }).strict(),
  z.object({ exists: z.literal(true), value: z.json() }).strict(),
]);

const eventCheckSchema = z
  .object({
    eventId: idSchema,
    reason: z.enum([
      'counted',
      'matched',
      'not_yet',
      'outside_window',
      'wrong_type',
      'filter_mismatch',
      'product_missing',
      'product_mismatch',
      'already_used',
      'not_checked',
    ]),
  })
  .strict();

const stepBaseShape = {
  order: z.number().int().min(1),
  nodeId: z.string().min(1).max(NODE_ID_MAX_LENGTH),
  nodeName: z.string().min(1).max(120),
  elapsedSeconds: z.number().int().min(0),
};

const startStepSchema = z
  .object({ ...stepBaseShape, nodeType: z.literal('start'), entryBehavior: entryBehaviorSchema })
  .strict();

const conditionStepSchema = z
  .object({
    ...stepBaseShape,
    nodeType: z.literal('condition'),
    rule: journeyConditionRuleSchema,
    matched: z.boolean(),
    branch: z.enum(['met', 'unmet']),
    evidence: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('value'), actual: simulationEvidenceValueSchema }).strict(),
      z
        .object({
          kind: z.literal('event_count'),
          evaluatedAtSeconds: z.number().int(),
          windowStartSeconds: z.number().int(),
          windowEndSeconds: z.number().int(),
          count: z.number().int().min(0),
          checks: z.array(eventCheckSchema),
        })
        .strict(),
    ]),
  })
  .strict();

const waitStepSchema = z
  .object({
    ...stepBaseShape,
    nodeType: z.literal('wait'),
    waitSeconds: z.number().int().min(1),
    elapsedBefore: z.number().int().min(0),
    elapsedAfter: z.number().int().min(0),
  })
  .strict();

const waitForEventStepSchema = z
  .object({
    ...stepBaseShape,
    nodeType: z.literal('wait_for_event'),
    config: waitForEventConfigSchema,
    startedAtSeconds: z.number().int().min(0),
    deadlineSeconds: z.number().int().min(1),
    resolvedAtSeconds: z.number().int().min(0),
    outcome: z.enum(['matched', 'timeout']),
    branch: z.enum(['matched', 'timeout']),
    matchedEventId: idSchema.nullable(),
    checks: z.array(eventCheckSchema),
  })
  .strict();

const messageStepSchema = z
  .object({
    ...stepBaseShape,
    nodeType: z.literal('message'),
    channel: z.enum(['sms', 'push', 'email']),
    subject: z.string().max(200).nullable(),
    body: z.string().min(1).max(2_000),
  })
  .strict();

const endStepSchema = z
  .object({ ...stepBaseShape, nodeType: z.literal('end'), note: z.string().max(500).nullable() })
  .strict();

export const journeySimulationStepSchema = z.discriminatedUnion('nodeType', [
  startStepSchema,
  conditionStepSchema,
  waitStepSchema,
  waitForEventStepSchema,
  messageStepSchema,
  endStepSchema,
]);

const simulationUserSummarySchema = z
  .object({ displayName: z.string().max(DISPLAY_NAME_MAX_LENGTH).nullable() })
  .strict();

const simulationAdmissionSchema = z
  .object({
    entryBehavior: z
      .object({ expected: entryBehaviorSchema, actual: entryBehaviorSchema, matched: z.boolean() })
      .strict(),
    segment: z
      .object({
        id: z.uuid(),
        name: z.string().min(1).max(SEGMENT_NAME_MAX_LENGTH),
        rules: segmentRuleSchema,
        matched: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();

const completedSimulationSchema = z
  .object({
    outcome: z.literal('completed'),
    user: simulationUserSummarySchema,
    admission: simulationAdmissionSchema,
    steps: z.array(journeySimulationStepSchema).min(1),
    traversedEdgeIds: z.array(idSchema),
    elapsedSeconds: z.number().int().min(0),
  })
  .strict();

const notEnteredSimulationSchema = z
  .object({
    outcome: z.literal('not_entered'),
    user: simulationUserSummarySchema,
    admission: simulationAdmissionSchema,
    steps: z.array(journeySimulationStepSchema).length(0),
    traversedEdgeIds: z.array(idSchema).length(0),
    elapsedSeconds: z.literal(0),
  })
  .strict();

export const journeySimulationResultSchema = z.discriminatedUnion('outcome', [
  completedSimulationSchema,
  notEnteredSimulationSchema,
]);

export const journeySimulationResponseSchema = z
  .object({ data: journeySimulationResultSchema })
  .strict();

export const journeySimulationRequestSchema = z
  .object({
    draftDefinition: journeyDraftDefinitionSchema,
    scenario: journeySimulationScenarioSchema,
  })
  .strict();

export const simulationEventTypeSchema = eventTypeSchema;

export type JourneySimulationScenario = z.infer<typeof journeySimulationScenarioSchema>;
export type JourneySimulation = z.infer<typeof journeySimulationRequestSchema>;
export type JourneySimulationInput = z.input<typeof journeySimulationRequestSchema>;
export type JourneySimulationStep = z.infer<typeof journeySimulationStepSchema>;
export type JourneySimulationResult = z.infer<typeof journeySimulationResultSchema>;
export type SimulationAdmission = z.infer<typeof simulationAdmissionSchema>;
export type SimulationEvidenceValue = z.infer<typeof simulationEvidenceValueSchema>;
export type SimulationEventCheck = z.infer<typeof eventCheckSchema>;
export type SimulationJsonValue =
  string | number | boolean | null | SimulationJsonValue[] | { [key: string]: SimulationJsonValue };
export type { JourneyConditionRule };
