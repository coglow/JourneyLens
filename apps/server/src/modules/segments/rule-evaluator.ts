import { AUDIENCE_COLUMN_KEYS } from '@journeylens/shared';
import type {
  AudienceColumnKey,
  AudienceFieldKey,
  JsonScalar,
  SegmentRule,
} from '@journeylens/shared';

export interface SegmentAudienceInput {
  displayName: string;
  email: string | null;
  attributes: unknown;
}

function isColumnKey(path: AudienceFieldKey): path is AudienceColumnKey {
  return (AUDIENCE_COLUMN_KEYS as readonly string[]).includes(path);
}

function readValue(user: SegmentAudienceInput, path: AudienceFieldKey): unknown {
  if (isColumnKey(path)) return user[path];

  const attributes = user.attributes;
  if (typeof attributes !== 'object' || attributes === null || Array.isArray(attributes)) {
    return undefined;
  }
  if (!Object.hasOwn(attributes, path)) return undefined;
  return (attributes as Record<string, unknown>)[path];
}

function isJsonScalar(value: unknown): value is JsonScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  return typeof value === 'number' && Number.isFinite(value);
}

function isScalarArray(value: unknown): value is JsonScalar[] {
  return Array.isArray(value) && value.every(isJsonScalar);
}

function evaluateCompare(
  rule: Extract<SegmentRule, { kind: 'compare' }>,
  user: SegmentAudienceInput,
): boolean {
  const left = readValue(user, rule.left.path);

  if (rule.operator === 'exists') {
    // null 和缺失都算“未填写”，所以“已填写”只认非空值。
    return left !== null && left !== undefined;
  }
  // 缺失值不参与普通比较；这样“不等于”不会把没有该属性的人算进来。
  if (left === undefined) return false;

  const right = rule.right;
  if (right === undefined) return false;

  switch (rule.operator) {
    case 'eq':
    case 'neq': {
      // 严格比较：数字 '5' 和 5、布尔 'true' 和 true 都不相等。
      if (!isJsonScalar(left) || !isJsonScalar(right)) return false;
      if (left !== null && right !== null && typeof left !== typeof right) return false;
      const equal = left === right;
      return rule.operator === 'eq' ? equal : !equal;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (typeof left !== 'number' || !Number.isFinite(left) || typeof right !== 'number') {
        return false;
      }
      if (rule.operator === 'gt') return left > right;
      if (rule.operator === 'gte') return left >= right;
      if (rule.operator === 'lt') return left < right;
      return left <= right;
    }
    case 'in':
    case 'not_in': {
      // 缺失值已经在上面提前返回，所以 not_in 不会命中“没有该属性”的人；
      // 若想包含缺失值，应写成 not(in ...)，由外层“非”取反。
      if (!isJsonScalar(left) || !Array.isArray(right)) return false;
      const member = right.includes(left);
      return rule.operator === 'in' ? member : !member;
    }
    case 'contains': {
      // 文本用子串匹配，数组用成员匹配；两种都不做类型转换。
      if (typeof left === 'string' && typeof right === 'string') {
        if (right.length === 0) return false;
        return left.includes(right);
      }
      if (isScalarArray(left) && isJsonScalar(right)) {
        return left.includes(right);
      }
      return false;
    }
  }
}

/** 递归组合“且／或／非”，条件树的结构和规模已由契约限制。 */
export function evaluateSegmentRule(rule: SegmentRule, user: SegmentAudienceInput): boolean {
  switch (rule.kind) {
    case 'all':
      return rule.children.every((child) => evaluateSegmentRule(child, user));
    case 'any':
      return rule.children.some((child) => evaluateSegmentRule(child, user));
    case 'not':
      return !evaluateSegmentRule(rule.child, user);
    case 'compare':
      return evaluateCompare(rule, user);
  }
}
