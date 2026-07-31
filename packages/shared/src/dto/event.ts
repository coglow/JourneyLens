import { z } from 'zod';
import { validateFieldValue } from '../journeys/field-value.js';
import {
  JOURNEY_EVENT_TYPES,
  journeyEventFields,
  type JourneyEventType,
} from '../journeys/journey-events.js';

export const EVENT_EXTERNAL_ID_MAX_LENGTH = 160;

/**
 * 上报必填标识只放在接收契约里：模拟资料仍可留空，外部系统发送的行为必须能区分具体对象。
 * 注册与订阅没有单独的业务 ID，用户 ID 就是它们的标识。
 */
export const EVENT_REQUIRED_IDENTIFIER_KEYS: Record<JourneyEventType, readonly string[]> = {
  product_viewed: ['productId'],
  purchase_completed: ['orderId'],
  reservation_created: ['reservationId'],
  app_session_started: ['sessionId'],
  app_exit: ['sessionId'],
  registration_completed: [],
  subscription_started: [],
};

export const eventPayloadSchema = z.record(z.string(), z.json());

function validateEventPayload(
  type: JourneyEventType,
  payload: Record<string, unknown>,
  ctx: z.RefinementCtx,
): void {
  const allowedKeys = new Set<string>(journeyEventFields(type).map((field) => field.key));
  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload', key],
        message: '该行为不支持此属性',
      });
    }
  }

  const requiredKeys = new Set(EVENT_REQUIRED_IDENTIFIER_KEYS[type]);
  for (const field of journeyEventFields(type)) {
    const value = payload[field.key];
    if (requiredKeys.has(field.key)) {
      // 必填标识必须是去掉首尾空格后仍有内容的文字，其他属性仍按现有目录校验。
      if (typeof value !== 'string' || value.trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['payload', field.key],
          message: `${field.label} 不能为空`,
        });
        continue;
      }
    }
    const message = validateFieldValue(field, value);
    if (message !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['payload', field.key], message });
    }
  }
}

/**
 * 上游行为接收契约：ID 由发送方生成，重试复用；用户、时间和运行事实都由服务端决定。
 * 请求不允许携带画像、版本、执行状态或步骤结果。
 */
export const eventIngestSchema = z
  .object({
    id: z.uuid({ error: '行为 ID 无效' }),
    audienceExternalId: z
      .string({ error: '用户 ID 不能为空' })
      .trim()
      .min(1, '用户 ID 不能为空')
      .max(EVENT_EXTERNAL_ID_MAX_LENGTH, `用户 ID 最多 ${EVENT_EXTERNAL_ID_MAX_LENGTH} 个字符`),
    type: z.enum(JOURNEY_EVENT_TYPES, { error: '请选择有效的行为类型' }),
    payload: eventPayloadSchema,
  })
  .strict()
  .superRefine((value, ctx) => validateEventPayload(value.type, value.payload, ctx));

export const eventIngestExecutionRefSchema = z.object({ id: z.uuid() }).strict();

export const eventIngestResultSchema = z
  .object({
    event: z
      .object({
        id: z.uuid(),
        receivedAt: z.iso.datetime(),
      })
      .strict(),
    executions: z.array(eventIngestExecutionRefSchema),
    // 同一 ID 同内容的重试返回原事实，不重新读取画像或匹配版本。
    duplicate: z.boolean(),
  })
  .strict();

export const eventIngestResponseSchema = z.object({ data: eventIngestResultSchema }).strict();

export const eventSummarySchema = z
  .object({
    id: z.uuid(),
    type: z.enum(JOURNEY_EVENT_TYPES),
    receivedAt: z.iso.datetime(),
    payload: eventPayloadSchema,
  })
  .strict();

export type EventIngest = z.output<typeof eventIngestSchema>;
export type EventIngestInput = z.input<typeof eventIngestSchema>;
export type EventIngestResult = z.infer<typeof eventIngestResultSchema>;
export type EventSummary = z.infer<typeof eventSummarySchema>;
