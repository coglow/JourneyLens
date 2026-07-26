import { z } from 'zod';
import { COMPARISON_OPERATORS, type ComparisonOperator } from '../audience/audience-catalog.js';
import { segmentCompareRuleSchema } from '../segments/segment-rule.js';
import { JOURNEY_WAIT_MAX_SECONDS } from './journey-limits.js';
import { JOURNEY_EVENT_TYPES, journeyEventField, type JourneyEventType } from './journey-events.js';

const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const numericOperators = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;
const numericOperatorSchema = z.enum(numericOperators);

const entryEventCompareShape = z
  .object({
    kind: z.literal('compare'),
    left: z
      .object({
        source: z.literal('entry_event'),
        eventType: z.enum(JOURNEY_EVENT_TYPES),
        path: z.string().min(1).max(40),
      })
      .strict(),
    operator: z.enum(COMPARISON_OPERATORS),
    right: scalarSchema.optional(),
  })
  .strict();

function validateAttributeCompare(
  value: z.infer<typeof entryEventCompareShape>,
  ctx: z.RefinementCtx,
): void {
  const field = journeyEventField(value.left.eventType, value.left.path);
  if (field === undefined) {
    ctx.addIssue({ code: 'custom', path: ['left', 'path'], message: '请选择该行为支持的属性' });
    return;
  }

  const allowedOperators: readonly ComparisonOperator[] =
    field.kind === 'number'
      ? [...numericOperators, 'exists']
      : field.values === undefined
        ? ['eq', 'neq', 'contains', 'exists']
        : ['eq', 'neq', 'exists'];
  if (!allowedOperators.includes(value.operator)) {
    ctx.addIssue({
      code: 'custom',
      path: ['operator'],
      message: `${field.label}不支持这种比较方式`,
    });
    return;
  }

  if (value.operator === 'exists') {
    if (value.right !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['right'], message: '“已填写”条件不需要比较值' });
    }
    return;
  }
  if (value.right === undefined || value.right === null || value.right === '') {
    ctx.addIssue({ code: 'custom', path: ['right'], message: '请填写比较值' });
    return;
  }

  if (field.kind === 'number') {
    if (typeof value.right !== 'number') {
      ctx.addIssue({ code: 'custom', path: ['right'], message: '请填写数字比较值' });
      return;
    }
    if (field.minimum !== undefined && value.right < field.minimum) {
      ctx.addIssue({
        code: 'custom',
        path: ['right'],
        message: `${field.label}不能小于 ${field.minimum}`,
      });
    }
    if (
      field.precision === 2 &&
      Math.abs(value.right * 100 - Math.round(value.right * 100)) >= 1e-6
    ) {
      ctx.addIssue({ code: 'custom', path: ['right'], message: `${field.label}最多保留两位小数` });
    }
  } else if (typeof value.right !== 'string') {
    ctx.addIssue({ code: 'custom', path: ['right'], message: '请填写文字比较值' });
  } else if (field.maxLength !== undefined && value.right.length > field.maxLength) {
    ctx.addIssue({
      code: 'custom',
      path: ['right'],
      message: `${field.label}最多 ${field.maxLength} 个字符`,
    });
  } else if (
    field.values !== undefined &&
    !field.values.some((item) => item.value === value.right)
  ) {
    ctx.addIssue({ code: 'custom', path: ['right'], message: `请选择有效的${field.label}` });
  }
}

const entryEventCompareRuleSchema = entryEventCompareShape.superRefine(validateAttributeCompare);

export const journeyEventFilterSchema = z
  .object({
    path: z.string().min(1).max(40),
    operator: z.enum(COMPARISON_OPERATORS),
    right: scalarSchema.optional(),
  })
  .strict();

function validateEventFilter(
  eventType: JourneyEventType,
  filter: z.infer<typeof journeyEventFilterSchema> | undefined,
  ctx: z.RefinementCtx,
  path: Array<string | number>,
): void {
  if (filter === undefined) return;
  const field = journeyEventField(eventType, filter.path);
  if (field === undefined) {
    ctx.addIssue({ code: 'custom', path: [...path, 'path'], message: '请选择该行为支持的属性' });
    return;
  }
  const parsed = entryEventCompareRuleSchema.safeParse({
    kind: 'compare',
    left: { source: 'entry_event', eventType, path: filter.path },
    operator: filter.operator,
    ...(filter.right === undefined ? {} : { right: filter.right }),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const targetPath = issue.path.at(-1) === 'right' ? 'right' : 'operator';
      ctx.addIssue({ code: 'custom', path: [...path, targetPath], message: issue.message });
    }
  }
}

const eventCountRuleSchema = z
  .object({
    kind: z.literal('event_count'),
    eventType: z.enum(JOURNEY_EVENT_TYPES),
    windowSeconds: z
      .number({ error: '统计时间窗口必须是整数秒' })
      .int('统计时间窗口必须是整数秒')
      .min(1, '统计时间窗口至少 1 秒')
      .max(JOURNEY_WAIT_MAX_SECONDS, '统计时间窗口最多 30 天'),
    filter: journeyEventFilterSchema.optional(),
    sameProduct: z.boolean(),
    operator: numericOperatorSchema,
    right: z
      .number({ error: '比较次数必须是整数' })
      .int('比较次数必须是整数')
      .min(0, '比较次数不能小于 0')
      .max(Number.MAX_SAFE_INTEGER, '比较次数超出可计算范围'),
  })
  .strict()
  .superRefine((value, ctx) => validateEventFilter(value.eventType, value.filter, ctx, ['filter']));

/** 按稳定的规则标记选择契约，保留分群比较规则原有的字段错误提示。 */
export const journeyConditionRuleSchema = z.unknown().transform((value, ctx) => {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const left =
    typeof record.left === 'object' && record.left !== null
      ? (record.left as Record<string, unknown>)
      : {};
  const schema =
    record.kind === 'event_count'
      ? eventCountRuleSchema
      : record.kind === 'compare' && left.source === 'entry_event'
        ? entryEventCompareRuleSchema
        : segmentCompareRuleSchema;
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
  }
  return z.NEVER;
});

export const waitForEventConfigShape = {
  eventType: z.enum(JOURNEY_EVENT_TYPES),
  waitSeconds: z
    .number({ error: '最长等待时间必须是整数秒' })
    .int('最长等待时间必须是整数秒')
    .min(1, '最长等待时间至少 1 秒')
    .max(JOURNEY_WAIT_MAX_SECONDS, '最长等待时间最多 30 天'),
  filter: journeyEventFilterSchema.optional(),
  sameProduct: z.boolean(),
};

/** 等待配置的筛选校验只写一份：行为等待节点直接复用这个函数，不重复解析同一份数据。 */
export function refineWaitForEventConfig(
  value: { eventType: JourneyEventType; filter?: JourneyEventFilter | undefined },
  ctx: z.RefinementCtx,
): void {
  validateEventFilter(value.eventType, value.filter, ctx, ['filter']);
}

export const waitForEventConfigSchema = z
  .object(waitForEventConfigShape)
  .strict()
  .superRefine(refineWaitForEventConfig);

export type JourneyConditionRule = z.infer<typeof journeyConditionRuleSchema>;
export type JourneyEventFilter = z.infer<typeof journeyEventFilterSchema>;
