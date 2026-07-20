import { z } from 'zod';
import {
  AUDIENCE_FIELD_KEYS,
  COMPARISON_OPERATORS,
  audienceField,
  type AudienceField,
  type AudienceFieldKey,
  type ComparisonOperator,
} from '../audience/audience-catalog.js';

export const SEGMENT_CHILDREN_LIMIT = 20;
export const SEGMENT_MAX_DEPTH = 6;
export const SEGMENT_MAX_NODES = 100;

export const comparisonOperatorSchema = z.enum(COMPARISON_OPERATORS);

export const jsonScalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export type JsonScalar = z.infer<typeof jsonScalarSchema>;

export type SegmentRuleCompare = {
  kind: 'compare';
  left: { source: 'user'; path: AudienceFieldKey };
  operator: ComparisonOperator;
  right?: JsonScalar | JsonScalar[] | undefined;
};

export type SegmentRule =
  | { kind: 'all'; children: SegmentRule[] }
  | { kind: 'any'; children: SegmentRule[] }
  | { kind: 'not'; child: SegmentRule }
  | SegmentRuleCompare;

const compareRuleShape = z
  .object({
    kind: z.literal('compare'),
    left: z
      .object({
        source: z.literal('user'),
        path: z.enum(AUDIENCE_FIELD_KEYS),
      })
      .strict(),
    operator: comparisonOperatorSchema,
    right: z.union([jsonScalarSchema, z.array(jsonScalarSchema)]).optional(),
  })
  .strict();

function hasAtMostTwoDecimals(value: number): boolean {
  // 19.99 * 100 在浮点数里不是精确的 1999，不能直接用 === 判断。
  const scaled = value * 100;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

function addValueIssue(ctx: z.RefinementCtx, message: string): void {
  ctx.addIssue({ code: 'custom', message, path: ['right'] });
}

function validateNumberValue(field: AudienceField, value: number, ctx: z.RefinementCtx): void {
  if (field.minimum !== undefined && value < field.minimum) {
    addValueIssue(ctx, `${field.label}不能小于 ${String(field.minimum)}`);
    return;
  }
  if (field.precision === 0 && !Number.isSafeInteger(value)) {
    addValueIssue(ctx, `${field.label}必须是整数`);
    return;
  }
  if (field.precision === 2 && !hasAtMostTwoDecimals(value)) {
    addValueIssue(ctx, `${field.label}最多保留两位小数`);
  }
}

function validateEnumValues(
  field: AudienceField,
  values: JsonScalar[],
  operator: ComparisonOperator,
  ctx: z.RefinementCtx,
): void {
  if (operator !== 'in' && operator !== 'not_in') {
    addValueIssue(ctx, '该比较方式只接受单个比较值');
    return;
  }
  if (values.length === 0) {
    addValueIssue(ctx, '请至少选择一个比较值');
    return;
  }
  if (field.values === undefined) {
    addValueIssue(ctx, '该用户属性不支持多选比较值');
    return;
  }
  const allowed = new Set(field.values.map((item) => item.value));
  if (values.some((item) => typeof item !== 'string' || !allowed.has(item))) {
    addValueIssue(ctx, '比较值不在可选范围内');
  }
}

function validateCompareRule(value: z.infer<typeof compareRuleShape>, ctx: z.RefinementCtx): void {
  const field = audienceField(value.left.path);
  if (field === undefined) {
    ctx.addIssue({ code: 'custom', message: '请选择有效的用户属性' });
    return;
  }
  if (!field.operators.includes(value.operator)) {
    ctx.addIssue({
      code: 'custom',
      message: `${field.label}不支持“${value.operator}”比较`,
    });
    return;
  }

  if (value.operator === 'exists') {
    if (value.right !== undefined) {
      addValueIssue(ctx, '“已填写”条件不需要比较值');
    }
    return;
  }

  // 未填写统一用 not(exists) 表达；undefined 和 null 都视为缺少比较值。
  if (value.right === undefined || value.right === null) {
    addValueIssue(ctx, '请填写比较值');
    return;
  }

  if (Array.isArray(value.right)) {
    validateEnumValues(field, value.right, value.operator, ctx);
    return;
  }

  if (value.operator === 'in' || value.operator === 'not_in') {
    addValueIssue(ctx, '请至少选择一个比较值');
    return;
  }

  if (typeof value.right === 'string' && value.right.length === 0) {
    addValueIssue(ctx, '请填写比较值');
    return;
  }

  switch (field.kind) {
    case 'number': {
      if (typeof value.right !== 'number') {
        addValueIssue(ctx, '请填写数字比较值');
        return;
      }
      validateNumberValue(field, value.right, ctx);
      return;
    }
    case 'boolean': {
      if (typeof value.right !== 'boolean') {
        addValueIssue(ctx, '请选择“是”或“否”');
      }
      return;
    }
    case 'string': {
      if (typeof value.right !== 'string') {
        addValueIssue(ctx, '请填写文本比较值');
        return;
      }
      if (field.values !== undefined && !field.values.some((item) => item.value === value.right)) {
        addValueIssue(ctx, '比较值不在可选范围内');
      }
      return;
    }
    case 'string[]': {
      if (typeof value.right !== 'string') {
        addValueIssue(ctx, '请选择一个标签');
        return;
      }
      if (field.values !== undefined && !field.values.some((item) => item.value === value.right)) {
        addValueIssue(ctx, '该标签不在可选范围内');
      }
      return;
    }
  }
}

const compareRuleSchema = compareRuleShape.superRefine(validateCompareRule);

const segmentRuleNodeSchema: z.ZodType<SegmentRule> = z.lazy(() => {
  const childrenSchema = z
    .array(segmentRuleNodeSchema)
    .min(1, '条件组至少需要 1 个条件')
    .max(SEGMENT_CHILDREN_LIMIT, `每个条件组最多包含 ${SEGMENT_CHILDREN_LIMIT} 个条件或条件组`);

  return z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all'), children: childrenSchema }).strict(),
    z.object({ kind: z.literal('any'), children: childrenSchema }).strict(),
    z.object({ kind: z.literal('not'), child: segmentRuleNodeSchema }).strict(),
    compareRuleSchema,
  ]);
});

type RuleIssue = {
  code: string;
  message?: string | undefined;
  path?: Array<string | number | symbol> | undefined;
};

function isRuleRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rawRuleChildren(node: Record<string, unknown>): readonly Record<string, unknown>[] {
  if (node.kind === 'not') {
    return isRuleRecord(node.child) ? [node.child] : [];
  }
  if ((node.kind === 'all' || node.kind === 'any') && Array.isArray(node.children)) {
    return node.children.filter(isRuleRecord);
  }
  return [];
}

/** 在递归解析前限制层数与节点数，避免超深或超大的输入进入递归。 */
function checkRuleLimitsBeforeParse(payload: { value: unknown; issues: RuleIssue[] }): void {
  if (!isRuleRecord(payload.value)) return;

  let nodes = 0;
  const pending: Array<{ node: Record<string, unknown>; depth: number }> = [
    { node: payload.value, depth: 1 },
  ];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    const kind = current.node.kind;
    if (kind !== 'all' && kind !== 'any' && kind !== 'not' && kind !== 'compare') {
      continue;
    }
    nodes += 1;
    if (current.depth > SEGMENT_MAX_DEPTH) {
      payload.issues.push({
        code: 'custom',
        message: `分群规则最多嵌套 ${SEGMENT_MAX_DEPTH} 层`,
        path: [],
      });
      return;
    }
    if (nodes > SEGMENT_MAX_NODES) {
      payload.issues.push({
        code: 'custom',
        message: `分群规则最多包含 ${SEGMENT_MAX_NODES} 个条件或条件组`,
        path: [],
      });
      return;
    }
    const children = rawRuleChildren(current.node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push({ node: child, depth: current.depth + 1 });
      }
    }
  }
}

export const segmentRuleSchema: z.ZodType<SegmentRule> = z
  .any()
  .check(checkRuleLimitsBeforeParse)
  .pipe(segmentRuleNodeSchema);
