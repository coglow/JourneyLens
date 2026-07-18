import {
  COMPARISON_OPERATOR_LABELS,
  audienceField,
  type AudienceField,
  type ComparisonOperator,
} from '../audience/audience-catalog.js';
import type { JsonScalar, SegmentRule } from './segment-rule.js';

/**
 * 规则节点的结构路径，相对规则根节点：
 * 根为 []，条件组子项为 ['children', index]，取反子项为 ['child']。
 */
export type SegmentRulePath = ReadonlyArray<'children' | 'child' | number>;

export type SegmentRuleFindingKind = 'unsatisfiable' | 'always-true';

export interface SegmentRuleFinding {
  /** unsatisfiable 表示可证明整体不可能命中；always-true 用于提醒规则会命中全部用户。 */
  kind: SegmentRuleFindingKind;
  /** 问题所在节点。 */
  path: SegmentRulePath;
  /** 参与冲突的条件节点，前端据此定位并高亮。 */
  memberPaths: readonly SegmentRulePath[];
  message: string;
}

export interface SegmentRuleAnalysis {
  /** 只有能够确定整体不可能命中时才为 true；后端据此阻止保存。 */
  rootUnsatisfiable: boolean;
  rootAlwaysTrue: boolean;
  findings: readonly SegmentRuleFinding[];
}

type CompareRule = Extract<SegmentRule, { kind: 'compare' }>;

/**
 * 分析器只认这些约束形态。无法可靠转换的条件直接跳过，避免把可能命中的规则判成矛盾，阻止用户保存合法规则
 */
type Constraint =
  // 同字段的允许值与排除值集合
  | { form: 'values'; allowed: boolean; values: readonly JsonScalar[] }
  // 同字段的数字区间
  | { form: 'range'; operator: 'gt' | 'gte' | 'lt' | 'lte'; value: number }
  // 单个兴趣标签的包含／不包含
  | { form: 'tag'; required: boolean; tag: string }
  // 任一标签命中
  | { form: 'tag-any'; tags: readonly string[] }
  // 已填写
  | { form: 'present' }
  // 未填写（not exists），缺失和 null 都满足
  | { form: 'not-filled' };

interface ConstraintEntry {
  path: SegmentRulePath;
  field: AudienceField;
  text: string;
  /** 字段缺失时是否满足该条件；普通比较为 false，取反后为 true。 */
  allowsMissing: boolean;
  /** null 值是否满足该条件；用于保留当前求值器的 null 语义。 */
  allowsNull: boolean;
  constraint: Constraint;
}

interface NodeAnalysis {
  /** unknown 只表示无法确定，不能据此认定规则可满足。 */
  status: 'unknown' | 'unsatisfiable' | 'always-true';
  /** 支持当前结论的条件，供父节点继续使用并生成定位信息。 */
  relatedConditions: readonly ConstraintEntry[];
  /** 该子树内需要提示的问题；由分析本身直接产出，避免再次遍历。 */
  findings: readonly SegmentRuleFinding[];
}

interface Bound {
  value: number;
  /** 是否包含端点，例如 >= 的下界包含端点，> 的下界不包含。 */
  closed: boolean;
}

const UNKNOWN_ANALYSIS: NodeAnalysis = { status: 'unknown', relatedConditions: [], findings: [] };

const NEGATED_OPERATOR: Partial<Record<ComparisonOperator, ComparisonOperator>> = {
  eq: 'neq',
  neq: 'eq',
  in: 'not_in',
  not_in: 'in',
  gt: 'lte',
  gte: 'lt',
  lt: 'gte',
  lte: 'gt',
};

/**
 * 纯函数分析：只依据规则树和属性目录，不访问数据库、不发请求。
 * 前端用于即时提醒和高亮，后端保存前再独立调用一次，两处结论保持一致。
 * 阅读顺序：分析节点结论 → 收集同时成立的约束 → 按字段检查冲突 → 生成提示。
 */
export function analyzeSegmentRuleSatisfiability(rules: SegmentRule): SegmentRuleAnalysis {
  const analysis = analyzeRuleNode(rules, []);

  return {
    rootUnsatisfiable: analysis.status === 'unsatisfiable',
    rootAlwaysTrue: analysis.status === 'always-true',
    findings: analysis.findings,
  };
}

/**
 * 自底向上分析结论：先分析子节点，再按“且／或／非”传播。
 * 只有“且”组需要额外收集必须同时成立的约束，检查同字段之间的冲突。
 */
function analyzeRuleNode(node: SegmentRule, path: SegmentRulePath): NodeAnalysis {
  if (node.kind === 'compare') return UNKNOWN_ANALYSIS;

  if (node.kind === 'not') {
    const child = analyzeRuleNode(node.child, [...path, 'child']);
    // 无法确定时保留子分支提示与原路径；确定时只交换“恒假”和“恒真”。
    if (child.status === 'unknown') return child;
    const status = child.status === 'unsatisfiable' ? 'always-true' : 'unsatisfiable';
    return concludeNode(status, child.relatedConditions, path);
  }

  const childResults = node.children.map((child, index) =>
    analyzeRuleNode(child, [...path, 'children', index]),
  );

  if (node.kind === 'all') {
    // 任一子项恒假，整个“且”组就恒假。
    const impossibleChild = childResults.find((result) => result.status === 'unsatisfiable');
    if (impossibleChild !== undefined) {
      return concludeNode('unsatisfiable', impossibleChild.relatedConditions, path);
    }

    const constraints = collectRequiredConstraints(node, false, path);
    if (constraints !== null) {
      const conflict = findConflictingConditions(constraints);
      if (conflict !== null) {
        return concludeNode('unsatisfiable', conflict, path);
      }
    }

    if (childResults.every((result) => result.status === 'always-true')) {
      const relatedConditions = uniqueConditionsByPath(
        childResults.flatMap((result) => result.relatedConditions),
      );
      return concludeNode('always-true', relatedConditions, path);
    }
  } else {
    // 所有子项恒假，“或”组才恒假；任一子项恒真，“或”组就恒真。
    if (childResults.every((result) => result.status === 'unsatisfiable')) {
      const relatedConditions = uniqueConditionsByPath(
        childResults.flatMap((result) => result.relatedConditions),
      );
      return concludeNode('unsatisfiable', relatedConditions, path);
    }

    const alwaysTrueChild = childResults.find((result) => result.status === 'always-true');
    if (alwaysTrueChild !== undefined) {
      return concludeNode('always-true', alwaysTrueChild.relatedConditions, path);
    }
  }

  // 整体无法确定时，只保留子分支已有的提示，不改变它们的定位。
  return { ...UNKNOWN_ANALYSIS, findings: childResults.flatMap((result) => result.findings) };
}

/**
 * 收集规则成立时必须同时满足的约束，不负责判断整棵树的结论。
 * negated 表示当前节点是否被取反；遇到“非”只翻转它，不修改原规则树。
 * 无法可靠转换的分支返回 null；“且”组仍可利用其余已知约束证明矛盾。
 */
function collectRequiredConstraints(
  node: SegmentRule,
  negated: boolean,
  path: SegmentRulePath,
): ConstraintEntry[] | null {
  if (node.kind === 'compare') {
    const entry = constraintForCompare(node, negated, path);
    return entry === null ? null : [entry];
  }

  if (node.kind === 'not') {
    return collectRequiredConstraints(node.child, !negated, [...path, 'child']);
  }

  const children = node.children;
  if (children.length === 1) {
    const only = children[0];
    return only === undefined
      ? null
      : collectRequiredConstraints(only, negated, [...path, 'children', 0]);
  }

  if (node.kind === 'all') {
    // not(all(A, B)) 是“或”，这里不展开分支组合。
    if (negated) return null;
    const entries: ConstraintEntry[] = [];
    for (const [index, child] of children.entries()) {
      const childEntries = collectRequiredConstraints(child, false, [...path, 'children', index]);
      if (childEntries !== null) entries.push(...childEntries);
    }
    return entries;
  }

  if (negated) {
    // not(any(A, B)) 等价于“不满足 A 且不满足 B”。
    const entries: ConstraintEntry[] = [];
    for (const [index, child] of children.entries()) {
      const childEntries = collectRequiredConstraints(child, true, [...path, 'children', index]);
      if (childEntries !== null) entries.push(...childEntries);
    }
    return entries;
  }

  // 正向“任一满足”只有在所有子项都是同一标签字段的“包含”时，才能合并成一个任一命中约束。
  let sharedField: AudienceField | null = null;
  const tags: string[] = [];
  for (const child of children) {
    if (
      child.kind !== 'compare' ||
      child.operator !== 'contains' ||
      typeof child.right !== 'string'
    ) {
      return null;
    }
    const field = audienceField(child.left.path);
    if (field === undefined || field.kind !== 'string[]') return null;
    if (sharedField === null) {
      sharedField = field;
    } else if (sharedField.key !== field.key) {
      return null;
    }
    tags.push(child.right);
  }

  if (sharedField === null || tags.length === 0) return null;
  return [
    {
      path,
      field: sharedField,
      text: `${sharedField.label} 包含 ${tags.join(' 或 ')}`,
      allowsMissing: false,
      allowsNull: false,
      constraint: { form: 'tag-any', tags },
    },
  ];
}

function constraintForCompare(
  node: CompareRule,
  negated: boolean,
  path: SegmentRulePath,
): ConstraintEntry | null {
  const field = audienceField(node.left.path);
  if (field === undefined) return null;

  const base = {
    path,
    field,
    text: describeCompare(node, negated),
    // 普通比较在字段缺失时一律返回 false，只有“非”之后才可能为 true。
    allowsMissing: negated,
    // null 语义按原始操作符计算，再按取反状态翻转一次。
    allowsNull: negated ? !nullSatisfies(node.operator) : nullSatisfies(node.operator),
  };

  if (node.operator === 'exists') {
    return {
      ...base,
      constraint: negated ? { form: 'not-filled' } : { form: 'present' },
    };
  }

  if (node.operator === 'contains') {
    if (field.kind !== 'string[]' || typeof node.right !== 'string') return null;
    return {
      ...base,
      constraint: { form: 'tag', required: !negated, tag: node.right },
    };
  }

  // 反向操作符只描述普通值；缺失和 null 的结果已经单独保存在上面。
  const operator = negated ? NEGATED_OPERATOR[node.operator] : node.operator;
  if (operator === undefined) return null;

  if (isRangeOperator(operator)) {
    if (field.kind !== 'number' || typeof node.right !== 'number') return null;
    return {
      ...base,
      constraint: { form: 'range', operator, value: node.right },
    };
  }

  if (!isSetOperator(operator)) return null;
  if (node.right === undefined) return null;

  const raw = Array.isArray(node.right) ? node.right : [node.right];
  const values = raw.filter((value) => valueFitsField(field, value));
  if (values.length === 0) return null;

  return {
    ...base,
    constraint: { form: 'values', allowed: operator === 'eq' || operator === 'in', values },
  };
}

function isRangeOperator(
  operator: ComparisonOperator,
): operator is Extract<ComparisonOperator, 'gt' | 'gte' | 'lt' | 'lte'> {
  return operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte';
}

function isSetOperator(
  operator: ComparisonOperator,
): operator is Extract<ComparisonOperator, 'eq' | 'neq' | 'in' | 'not_in'> {
  return operator === 'eq' || operator === 'neq' || operator === 'in' || operator === 'not_in';
}

/** 比较值是否能真正放进该字段；放不进去的值不参与矛盾判断。 */
function valueFitsField(field: AudienceField, value: JsonScalar): boolean {
  if (field.kind === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (field.kind === 'boolean') return typeof value === 'boolean';
  if (field.kind === 'string[]') return false;
  return typeof value === 'string';
}

/**
 * 当前求值器里 null 值对原始比较的结果。
 * 取反后的结果由调用方按 negated 翻转一次，不能用反向操作符代替：
 * 例如 null 对 gt 和 lte 都是 false，但 not(gt) 是 true。
 */
function nullSatisfies(operator: ComparisonOperator): boolean {
  return operator === 'neq' || operator === 'not_in';
}

function findConflictingConditions(entries: readonly ConstraintEntry[]): ConstraintEntry[] | null {
  const byField = new Map<string, ConstraintEntry[]>();
  for (const entry of entries) {
    const bucket = byField.get(entry.field.key);
    if (bucket === undefined) {
      byField.set(entry.field.key, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  for (const bucket of byField.values()) {
    const field = bucket[0]?.field;
    if (field === undefined || !hasFieldConflict(field, bucket)) continue;

    // 逐项删去不影响结论的条件，便于高亮；不保证找到条数最少的冲突组。
    let conflictingConditions = [...bucket];
    for (const candidate of bucket) {
      const without = conflictingConditions.filter((entry) => entry !== candidate);
      if (without.length > 0 && hasFieldConflict(field, without)) conflictingConditions = without;
    }
    return conflictingConditions;
  }

  return null;
}

function hasFieldConflict(field: AudienceField, entries: readonly ConstraintEntry[]): boolean {
  // 字段缺失或 null 还能满足全部条件，就不能认定这些条件互相矛盾。
  if (entries.every((entry) => entry.allowsMissing)) return false;
  if (entries.every((entry) => entry.allowsNull)) return false;

  // 两条特殊值路径都不成立后，检查普通值是否也全部被排除。
  return ordinaryValuesAreImpossible(field, entries);
}

/** 字段的“真实值”是否已经不可能存在；缺失和 null 另行判断。 */
function ordinaryValuesAreImpossible(
  field: AudienceField,
  entries: readonly ConstraintEntry[],
): boolean {
  if (entries.some((entry) => entry.constraint.form === 'not-filled')) return true;
  if (field.kind === 'number') return numberDomainIsEmpty(entries);
  if (field.kind === 'string[]') return tagSetIsEmpty(entries);
  return valueSetIsEmpty(entries);
}

/** 收紧数字区间，再检查允许值是否被区间和排除值全部清空。 */
function numberDomainIsEmpty(entries: readonly ConstraintEntry[]): boolean {
  // null 表示没有限定允许值；空集合表示已经没有候选值，与字段值为 null 无关。
  let points: Set<number> | null = null;
  const excluded = new Set<number>();
  let lo: Bound | undefined;
  let hi: Bound | undefined;

  for (const entry of entries) {
    const constraint = entry.constraint;
    if (constraint.form === 'values') {
      const numbers = constraint.values.filter(
        (value): value is number => typeof value === 'number',
      );
      if (numbers.length === 0) continue;
      if (constraint.allowed) {
        const next = new Set(numbers);
        if (points === null) {
          points = next;
        } else {
          const kept = new Set<number>();
          for (const point of points) {
            if (next.has(point)) kept.add(point);
          }
          points = kept;
        }
      } else {
        for (const value of numbers) excluded.add(value);
      }
    } else if (constraint.form === 'range') {
      if (constraint.operator === 'gt' || constraint.operator === 'gte') {
        lo = tightenLowerBound(lo, {
          value: constraint.value,
          closed: constraint.operator === 'gte',
        });
      } else {
        hi = tightenUpperBound(hi, {
          value: constraint.value,
          closed: constraint.operator === 'lte',
        });
      }
    }
  }

  // 有明确的允许值时，只需要看这些点是否被区间或排除值清空。
  if (points !== null) {
    return [...points].every((point) => !withinRange(point, lo, hi) || excluded.has(point));
  }

  if (lo !== undefined && hi !== undefined) {
    if (lo.value > hi.value) return true;
    if (lo.value === hi.value) {
      if (!lo.closed || !hi.closed) return true;
      return excluded.has(lo.value);
    }
  }
  return false;
}

function tightenLowerBound(current: Bound | undefined, candidate: Bound): Bound {
  if (current === undefined) return candidate;
  if (candidate.value > current.value) return candidate;
  if (candidate.value < current.value) return current;
  return { value: current.value, closed: current.closed && candidate.closed };
}

function tightenUpperBound(current: Bound | undefined, candidate: Bound): Bound {
  if (current === undefined) return candidate;
  if (candidate.value < current.value) return candidate;
  if (candidate.value > current.value) return current;
  return { value: current.value, closed: current.closed && candidate.closed };
}

function withinRange(value: number, lo: Bound | undefined, hi: Bound | undefined): boolean {
  if (lo !== undefined && (lo.closed ? value < lo.value : value <= lo.value)) return false;
  if (hi !== undefined && (hi.closed ? value > hi.value : value >= hi.value)) return false;
  return true;
}

function valueSetIsEmpty(entries: readonly ConstraintEntry[]): boolean {
  // 允许集取交集、排除集取并集；null 表示尚无允许集，不代表字段值是 null。
  let allowed: Set<string> | null = null;
  const excluded = new Set<string>();

  for (const entry of entries) {
    const constraint = entry.constraint;
    if (constraint.form !== 'values') continue;
    const keys = constraint.values.map(scalarKey);
    if (constraint.allowed) {
      const next = new Set(keys);
      if (allowed === null) {
        allowed = next;
      } else {
        const kept = new Set<string>();
        for (const key of allowed) {
          if (next.has(key)) kept.add(key);
        }
        allowed = kept;
      }
    } else {
      for (const key of keys) excluded.add(key);
    }
  }

  return allowed !== null && [...allowed].every((key) => excluded.has(key));
}

function scalarKey(value: JsonScalar): string {
  return value === null ? 'null' : `${typeof value}:${String(value)}`;
}

/** 标签可同时拥有多个，只检查必选标签被禁止、任一命中组的标签全部被禁止这两类冲突。 */
function tagSetIsEmpty(entries: readonly ConstraintEntry[]): boolean {
  const required = new Set<string>();
  const forbidden = new Set<string>();
  const anyGroups: string[][] = [];

  for (const entry of entries) {
    const constraint = entry.constraint;
    if (constraint.form === 'tag') {
      (constraint.required ? required : forbidden).add(constraint.tag);
    } else if (constraint.form === 'tag-any') {
      anyGroups.push([...constraint.tags]);
    }
  }

  if ([...required].some((tag) => forbidden.has(tag))) return true;
  return anyGroups.some((tags) => tags.length > 0 && tags.every((tag) => forbidden.has(tag)));
}

/** 确定结论时统一生成当前节点的提示；子节点提示由这条整体结论替代。 */
function concludeNode(
  status: SegmentRuleFindingKind,
  relatedConditions: readonly ConstraintEntry[],
  path: SegmentRulePath,
): NodeAnalysis {
  return {
    status,
    relatedConditions,
    findings: [
      {
        kind: status,
        path,
        memberPaths: relatedConditions.map((entry) => entry.path),
        message:
          status === 'unsatisfiable'
            ? conflictMessage(relatedConditions)
            : alwaysTrueMessage(relatedConditions),
      },
    ],
  };
}

function uniqueConditionsByPath(entries: readonly ConstraintEntry[]): ConstraintEntry[] {
  const seen = new Set<string>();
  const result: ConstraintEntry[] = [];
  for (const entry of entries) {
    const key = pathKey(entry.path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function pathKey(path: SegmentRulePath): string {
  return path.join('.');
}

function conflictMessage(entries: readonly ConstraintEntry[]): string {
  if (entries.length === 0) return '这些条件互相矛盾，不可能命中任何用户';
  const texts = entries.map((entry) => `「${entry.text}」`);
  if (texts.length === 1) return `${texts[0] ?? ''}不可能成立`;
  const head = texts.slice(0, 2).join('与');
  return texts.length === 2
    ? `${head}不能同时成立`
    : `${head}等 ${texts.length} 条条件不能同时成立`;
}

function alwaysTrueMessage(entries: readonly ConstraintEntry[]): string {
  if (entries.length === 0) return '这些条件在任何情况下都会成立';
  const head = entries
    .slice(0, 2)
    .map((entry) => `「${entry.text}」`)
    .join('与');
  return `${head}互相矛盾，规则在任何情况下都会成立`;
}

function describeCompare(node: CompareRule, negated: boolean): string {
  const field = audienceField(node.left.path);
  const label = field?.label ?? node.left.path;

  if (node.operator === 'exists') {
    return negated ? `${label} 未填写` : `${label} 已填写`;
  }

  const text = `${label} ${COMPARISON_OPERATOR_LABELS[node.operator]} ${formatRight(node)}`;
  return negated ? `不满足：${text}` : text;
}

function formatRight(node: CompareRule): string {
  if (node.right === undefined) return '';
  if (Array.isArray(node.right)) return node.right.map(formatScalar).join('、');
  return formatScalar(node.right);
}

function formatScalar(value: JsonScalar): string {
  if (value === null) return '空值';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}
