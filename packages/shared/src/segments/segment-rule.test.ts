import { describe, expect, it } from 'vitest';
import { SEGMENT_MAX_DEPTH, SEGMENT_MAX_NODES, segmentRuleSchema } from './segment-rule.js';

const compare = {
  kind: 'compare',
  left: { source: 'user', path: 'age' },
  operator: 'gte',
  right: 18,
} as const;

function nested(depth: number): unknown {
  let node: unknown = compare;
  for (let level = 1; level < depth; level += 1) {
    node = { kind: 'all', children: [node] };
  }
  return node;
}

function wideRule(compareCountPerGroup: number): unknown {
  return {
    kind: 'all',
    children: Array.from({ length: 20 }, () => ({
      kind: 'any',
      children: Array.from({ length: compareCountPerGroup }, () => compare),
    })),
  };
}

// 远超 8 层限制：修复前这些字段会在联合分支中被递归解析并导致栈溢出。
const UNBOUNDED_DEPTH = 20_000;

function deepNotChain(levels: number): unknown {
  let node: unknown = compare;
  for (let level = 0; level < levels; level += 1) {
    node = { kind: 'not', child: node };
  }
  return node;
}

function deepAllChain(levels: number): unknown {
  let node: unknown = compare;
  for (let level = 0; level < levels; level += 1) {
    node = { kind: 'all', children: [node] };
  }
  return node;
}

describe('分群规则契约', () => {
  it('接受各字段类型对应的合法条件', () => {
    const validRules = [
      {
        kind: 'compare',
        left: { source: 'user', path: 'displayName' },
        operator: 'eq',
        right: '林小满',
      },
      { kind: 'compare', left: { source: 'user', path: 'email' }, operator: 'exists' },
      {
        kind: 'compare',
        left: { source: 'user', path: 'email' },
        operator: 'contains',
        right: '@example.com',
      },
      compare,
      { kind: 'compare', left: { source: 'user', path: 'totalSpend' }, operator: 'exists' },
      { kind: 'compare', left: { source: 'user', path: 'optInSms' }, operator: 'exists' },
      { kind: 'compare', left: { source: 'user', path: 'interests' }, operator: 'exists' },
      {
        kind: 'compare',
        left: { source: 'user', path: 'gender' },
        operator: 'in',
        right: ['female', 'male'],
      },
      { kind: 'compare', left: { source: 'user', path: 'gender' }, operator: 'exists' },
      {
        kind: 'compare',
        left: { source: 'user', path: 'city' },
        operator: 'in',
        right: ['上海', '北京'],
      },
      {
        kind: 'compare',
        left: { source: 'user', path: 'interests' },
        operator: 'contains',
        right: '数码',
      },
      {
        kind: 'compare',
        left: { source: 'user', path: 'optInSms' },
        operator: 'eq',
        right: false,
      },
      {
        kind: 'compare',
        left: { source: 'user', path: 'totalSpend' },
        operator: 'lte',
        right: 4000.5,
      },
    ];

    for (const rule of validRules) {
      expect(segmentRuleSchema.safeParse(rule).success).toBe(true);
    }
  });

  it('根节点计为第 1 层，第 8 层允许、第 9 层拒绝', () => {
    expect(segmentRuleSchema.safeParse(nested(SEGMENT_MAX_DEPTH)).success).toBe(true);

    const tooDeep = segmentRuleSchema.safeParse(nested(SEGMENT_MAX_DEPTH + 1));
    expect(tooDeep.success).toBe(false);
    expect(tooDeep.error?.issues[0]?.message).toBe(`分群规则最多嵌套 ${SEGMENT_MAX_DEPTH} 层`);
  });

  it('取反节点也计入层数', () => {
    let node: unknown = compare;
    for (let level = 1; level < SEGMENT_MAX_DEPTH; level += 1) {
      node = { kind: 'not', child: node };
    }
    expect(segmentRuleSchema.safeParse(node).success).toBe(true);

    const tooDeep = segmentRuleSchema.safeParse({ kind: 'not', child: node });
    expect(tooDeep.success).toBe(false);
    expect(tooDeep.error?.issues[0]?.message).toBe(`分群规则最多嵌套 ${SEGMENT_MAX_DEPTH} 层`);
  });

  it('单个条件组最多 20 项', () => {
    const allowed = {
      kind: 'all',
      children: Array.from({ length: 20 }, () => compare),
    };
    expect(segmentRuleSchema.safeParse(allowed).success).toBe(true);

    const tooMany = segmentRuleSchema.safeParse({
      kind: 'all',
      children: Array.from({ length: 21 }, () => compare),
    });
    expect(tooMany.success).toBe(false);
  });

  it('总节点最多 100 个', () => {
    const exactlyHundred = {
      kind: 'all',
      children: Array.from({ length: 20 }, (_, index) => ({
        kind: 'any',
        children: Array.from({ length: index === 0 ? 3 : 4 }, () => compare),
      })),
    };
    expect(segmentRuleSchema.safeParse(exactlyHundred).success).toBe(true);

    const tooMany = segmentRuleSchema.safeParse(wideRule(4));
    expect(tooMany.success).toBe(false);
    expect(tooMany.error?.issues[0]?.message).toBe(
      `分群规则最多包含 ${SEGMENT_MAX_NODES} 个条件或条件组`,
    );
  });

  it('拒绝空组、未知字段、目录外比较方式和不安全的结构字段', () => {
    const invalidRules = [
      { kind: 'all', children: [] },
      {
        kind: 'compare',
        left: { source: 'user', path: 'unknown' },
        operator: 'eq',
        right: 'x',
      },
      {
        kind: 'compare',
        left: { source: 'user', path: 'displayName' },
        operator: 'gt',
        right: 'x',
      },
      {
        kind: 'compare',
        left: { source: 'event', path: 'age' },
        operator: 'gte',
        right: 18,
      },
      { ...compare, extra: true },
      { kind: 'xor', children: [compare] },
      {
        kind: 'compare',
        left: { source: 'user', path: 'age' },
        operator: 'gte',
      },
      {
        kind: 'compare',
        left: { source: 'user', path: 'displayName' },
        operator: 'eq',
        right: '',
      },
      {
        kind: 'compare',
        left: { source: 'user', path: 'gender' },
        operator: 'in',
        right: [],
      },
      {
        kind: 'compare',
        left: { source: 'user', path: 'gender' },
        operator: 'in',
        right: ['unknown'],
      },
      {
        kind: 'compare',
        left: { source: 'user', path: 'gender' },
        operator: 'exists',
        right: true,
      },
      {
        kind: 'compare',
        left: { source: 'user', path: 'gender' },
        operator: 'in',
        right: null,
      },
      // “未填写”不再用 eq null 表达，统一改为 not(exists)。
      {
        kind: 'compare',
        left: { source: 'user', path: 'email' },
        operator: 'eq',
        right: null,
      },
    ];

    for (const rule of invalidRules) {
      expect(segmentRuleSchema.safeParse(rule).success).toBe(false);
    }
  });

  it('校验数字最小值、整数和金额精度', () => {
    const at = (path: string, operator: string, right: unknown) => ({
      kind: 'compare',
      left: { source: 'user', path },
      operator,
      right,
    });

    for (const rule of [
      at('age', 'gte', -1),
      at('age', 'gte', 18.5),
      at('totalOrders', 'eq', 1.5),
      at('totalSpend', 'gte', 12.345),
      at('totalSpend', 'gte', '12.34'),
      at('totalSpend', 'gte', 4000.001),
      at('optInSms', 'eq', 'true'),
      at('optInSms', 'eq', 1),
      at('interests', 'contains', '不存在的标签'),
      at('interests', 'contains', ['数码']),
    ]) {
      expect(segmentRuleSchema.safeParse(rule).success).toBe(false);
    }

    expect(segmentRuleSchema.safeParse(at('age', 'gte', 0)).success).toBe(true);
    expect(segmentRuleSchema.safeParse(at('totalOrders', 'eq', 0)).success).toBe(true);
    expect(segmentRuleSchema.safeParse(at('totalSpend', 'gte', 19.99)).success).toBe(true);
    expect(segmentRuleSchema.safeParse(at('totalSpend', 'gte', 4000.5)).success).toBe(true);
  });

  it('未知 kind 或错位字段携带超深子树时返回校验失败而不是栈溢出', () => {
    const inputs = [
      { kind: 'unsupported', child: deepNotChain(UNBOUNDED_DEPTH) },
      { ...compare, child: deepNotChain(UNBOUNDED_DEPTH) },
      { kind: 'unsupported', children: [deepAllChain(UNBOUNDED_DEPTH)] },
      { kind: 'not', child: compare, children: [deepAllChain(UNBOUNDED_DEPTH)] },
    ];

    for (const input of inputs) {
      const parse = () => segmentRuleSchema.safeParse(input);
      expect(parse).not.toThrow();
      expect(parse().success).toBe(false);
    }
  });
});
