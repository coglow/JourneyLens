import { describe, expect, it } from 'vitest';
import type { AudienceFieldKey, ComparisonOperator } from '../audience/audience-catalog.js';
import { analyzeSegmentRuleSatisfiability } from './segment-rule-satisfiability.js';
import type { JsonScalar, SegmentRule } from './segment-rule.js';

type CompareRule = Extract<SegmentRule, { kind: 'compare' }>;

function compare(
  path: AudienceFieldKey,
  operator: ComparisonOperator,
  right?: JsonScalar | JsonScalar[],
): SegmentRule {
  const rule: CompareRule = {
    kind: 'compare',
    left: { source: 'user', path },
    operator,
  };
  return right === undefined ? rule : { ...rule, right };
}

function all(...children: SegmentRule[]): SegmentRule {
  return { kind: 'all', children };
}

function any(...children: SegmentRule[]): SegmentRule {
  return { kind: 'any', children };
}

function not(child: SegmentRule): SegmentRule {
  return { kind: 'not', child };
}

describe('分群规则矛盾分析：能够确定的不可能命中', () => {
  it('同字段数字区间没有交集时判定整体不可能命中', () => {
    const result = analyzeSegmentRuleSatisfiability(
      all(compare('age', 'gt', 100), compare('age', 'lt', 10)),
    );

    expect(result.rootUnsatisfiable).toBe(true);
    expect(result.rootAlwaysTrue).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: 'unsatisfiable',
      path: [],
      memberPaths: [
        ['children', 0],
        ['children', 1],
      ],
    });
    expect(result.findings[0]?.message).toContain('年龄 大于 100');
    expect(result.findings[0]?.message).toContain('年龄 小于 10');
    expect(result.findings[0]?.message).toContain('不能同时成立');
  });

  it('闭区间无交集或塌缩成被排除的单点', () => {
    expect(
      analyzeSegmentRuleSatisfiability(all(compare('age', 'gte', 40), compare('age', 'lte', 30)))
        .rootUnsatisfiable,
    ).toBe(true);

    const collapsed = analyzeSegmentRuleSatisfiability(
      all(compare('age', 'gte', 30), compare('age', 'lte', 30), compare('age', 'neq', 30)),
    );
    expect(collapsed.rootUnsatisfiable).toBe(true);
    expect(collapsed.findings[0]?.memberPaths).toEqual([
      ['children', 0],
      ['children', 1],
      ['children', 2],
    ]);
  });

  it('同字段等值交集为空或被排除值清空', () => {
    expect(
      analyzeSegmentRuleSatisfiability(all(compare('age', 'eq', 30), compare('age', 'eq', 40)))
        .rootUnsatisfiable,
    ).toBe(true);

    expect(
      analyzeSegmentRuleSatisfiability(all(compare('age', 'eq', 30), compare('age', 'neq', 30)))
        .rootUnsatisfiable,
    ).toBe(true);
  });

  it('枚举的允许集与排除集完全重叠', () => {
    const result = analyzeSegmentRuleSatisfiability(
      all(
        compare('cityTier', 'in', ['tier1', 'tier2']),
        compare('cityTier', 'not_in', ['tier1', 'tier2']),
      ),
    );
    expect(result.rootUnsatisfiable).toBe(true);
    expect(result.findings[0]?.message).toContain('城市层级');
  });

  it('布尔条件互斥', () => {
    expect(
      analyzeSegmentRuleSatisfiability(
        all(compare('optInSms', 'eq', true), compare('optInSms', 'eq', false)),
      ).rootUnsatisfiable,
    ).toBe(true);
  });

  it('同一字段的已填写与未填写冲突', () => {
    expect(
      analyzeSegmentRuleSatisfiability(
        all(compare('gender', 'exists'), not(compare('gender', 'exists'))),
      ).rootUnsatisfiable,
    ).toBe(true);
  });

  it('同一兴趣标签的包含与不包含冲突', () => {
    const result = analyzeSegmentRuleSatisfiability(
      all(compare('interests', 'contains', '数码'), not(compare('interests', 'contains', '数码'))),
    );
    expect(result.rootUnsatisfiable).toBe(true);
    expect(result.findings[0]?.message).toContain('兴趣标签');
  });

  it('任一命中标签全部被排除时不可能命中', () => {
    const branch = any(
      compare('interests', 'contains', '数码'),
      compare('interests', 'contains', '游戏'),
    );
    expect(analyzeSegmentRuleSatisfiability(all(branch, not(branch))).rootUnsatisfiable).toBe(true);
  });

  it('双重否定归约后仍能判定，并给出取反子项路径', () => {
    expect(
      analyzeSegmentRuleSatisfiability(
        all(not(not(compare('cityTier', 'eq', 'tier2'))), compare('cityTier', 'neq', 'tier2')),
      ).rootUnsatisfiable,
    ).toBe(true);

    const result = analyzeSegmentRuleSatisfiability(
      all(not(compare('age', 'gt', 10)), compare('age', 'gt', 10)),
    );
    expect(result.rootUnsatisfiable).toBe(true);
    expect(result.findings[0]?.memberPaths).toEqual([
      ['children', 0, 'child'],
      ['children', 1],
    ]);
  });

  it('全部或分支都不可能命中时才判定整个分组', () => {
    const result = analyzeSegmentRuleSatisfiability(
      any(
        all(compare('cityTier', 'eq', 'tier2'), compare('cityTier', 'neq', 'tier2')),
        all(compare('age', 'gt', 100), compare('age', 'lt', 10)),
      ),
    );
    expect(result.rootUnsatisfiable).toBe(true);
    expect(result.findings[0]?.path).toEqual([]);
  });

  it('排除组本身矛盾时整体恒真，作为提醒而不阻止保存', () => {
    const result = analyzeSegmentRuleSatisfiability(
      not(all(compare('cityTier', 'eq', 'tier2'), compare('cityTier', 'neq', 'tier2'))),
    );
    expect(result.rootUnsatisfiable).toBe(false);
    expect(result.rootAlwaysTrue).toBe(true);
    expect(result.findings[0]?.kind).toBe('always-true');
    expect(result.findings[0]?.message).toContain('在任何情况下都会成立');
  });

  it('所有子组恒真时只提示整个且组，保留各子组参与条件的位置', () => {
    const result = analyzeSegmentRuleSatisfiability(
      all(
        not(all(compare('age', 'gt', 100), compare('age', 'lt', 10))),
        not(all(compare('optInSms', 'eq', true), compare('optInSms', 'eq', false))),
      ),
    );

    expect(result).toEqual({
      rootUnsatisfiable: false,
      rootAlwaysTrue: true,
      findings: [
        {
          kind: 'always-true',
          path: [],
          memberPaths: [
            ['children', 0, 'child', 'children', 0],
            ['children', 0, 'child', 'children', 1],
            ['children', 1, 'child', 'children', 0],
            ['children', 1, 'child', 'children', 1],
          ],
          message: '「年龄 大于 100」与「年龄 小于 10」互相矛盾，规则在任何情况下都会成立',
        },
      ],
    });
  });

  it('或组包含恒真分支时用该分支解释整体结论，不混入其他分支的提示', () => {
    const result = analyzeSegmentRuleSatisfiability(
      any(
        all(compare('age', 'gt', 100), compare('age', 'lt', 10)),
        not(all(compare('optInSms', 'eq', true), compare('optInSms', 'eq', false))),
        compare('age', 'eq', 30),
      ),
    );

    expect(result).toEqual({
      rootUnsatisfiable: false,
      rootAlwaysTrue: true,
      findings: [
        {
          kind: 'always-true',
          path: [],
          memberPaths: [
            ['children', 1, 'child', 'children', 0],
            ['children', 1, 'child', 'children', 1],
          ],
          message: '「短信订阅 等于 是」与「短信订阅 等于 否」互相矛盾，规则在任何情况下都会成立',
        },
      ],
    });
  });
});

describe('分群规则矛盾分析：无法确定时不误报', () => {
  it('部分或分支矛盾只定位该分支，不阻止整体保存', () => {
    const result = analyzeSegmentRuleSatisfiability(
      any(
        all(compare('cityTier', 'eq', 'tier2'), compare('cityTier', 'neq', 'tier2')),
        compare('age', 'gt', 30),
      ),
    );

    expect(result.rootUnsatisfiable).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: 'unsatisfiable',
      path: ['children', 0],
      memberPaths: [
        ['children', 0, 'children', 0],
        ['children', 0, 'children', 1],
      ],
    });
  });

  it('缺失值可以同时满足取反后的等值和不等于，不判为矛盾', () => {
    const result = analyzeSegmentRuleSatisfiability(
      all(not(compare('cityTier', 'eq', 'tier2')), not(compare('cityTier', 'neq', 'tier2'))),
    );
    expect(result.findings).toHaveLength(0);
    expect(result.rootUnsatisfiable).toBe(false);
  });

  it('null 值可以同时满足取反后的区间条件和不等于，不判为矛盾', () => {
    const result = analyzeSegmentRuleSatisfiability(
      all(not(compare('age', 'gt', 10)), not(compare('age', 'lte', 10)), compare('age', 'neq', 5)),
    );
    expect(result.rootUnsatisfiable).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it('补充已填写要求后，同一取反组合仍可判定矛盾', () => {
    const result = analyzeSegmentRuleSatisfiability(
      all(
        not(compare('age', 'gt', 10)),
        not(compare('age', 'lte', 10)),
        compare('age', 'neq', 5),
        compare('age', 'exists'),
      ),
    );
    expect(result.rootUnsatisfiable).toBe(true);
  });

  it('中性取反与分组仍保留子分支的定位路径', () => {
    const result = analyzeSegmentRuleSatisfiability(
      not(
        not(
          any(
            all(compare('cityTier', 'eq', 'tier2'), compare('cityTier', 'neq', 'tier2')),
            compare('age', 'gt', 30),
          ),
        ),
      ),
    );
    expect(result.rootUnsatisfiable).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.path).toEqual(['child', 'child', 'children', 0]);
    expect(result.findings[0]?.memberPaths).toEqual([
      ['child', 'child', 'children', 0, 'children', 0],
      ['child', 'child', 'children', 0, 'children', 1],
    ]);
  });

  it('单独的取反条件允许字段缺失', () => {
    expect(
      analyzeSegmentRuleSatisfiability(not(compare('cityTier', 'eq', 'tier2'))).findings,
    ).toHaveLength(0);
  });

  it('已填写与其它普通条件可以同时成立', () => {
    expect(
      analyzeSegmentRuleSatisfiability(
        all(compare('gender', 'exists'), not(compare('gender', 'in', ['female']))),
      ).findings,
    ).toHaveLength(0);
  });

  it('不同字段之间不做推理', () => {
    expect(
      analyzeSegmentRuleSatisfiability(
        all(compare('age', 'gt', 30), compare('lastActiveDaysAgo', 'gt', 5)),
      ).findings,
    ).toHaveLength(0);
  });

  it('一般或分支不与外部条件展开组合，未证明的矛盾仍不拦截', () => {
    const result = analyzeSegmentRuleSatisfiability(
      all(any(compare('age', 'eq', 20), compare('age', 'eq', 30)), compare('age', 'eq', 40)),
    );

    expect(result).toEqual({
      rootUnsatisfiable: false,
      rootAlwaysTrue: false,
      findings: [],
    });
  });

  it('不做有限域清空推理：不属于全部可选值不报', () => {
    expect(
      analyzeSegmentRuleSatisfiability(compare('cityTier', 'not_in', ['tier1', 'tier2', 'tier3']))
        .findings,
    ).toHaveLength(0);
  });

  it('布尔字段排除两个取值不报', () => {
    expect(
      analyzeSegmentRuleSatisfiability(
        all(compare('optInSms', 'neq', true), compare('optInSms', 'neq', false)),
      ).findings,
    ).toHaveLength(0);
  });

  it('文本子串包含不建模', () => {
    expect(
      analyzeSegmentRuleSatisfiability(
        all(
          compare('email', 'contains', '@example.com'),
          not(compare('email', 'contains', '@example.com')),
        ),
      ).findings,
    ).toHaveLength(0);
  });

  it('类型不符、目录外字段和不可靠分组不参与判定', () => {
    expect(
      analyzeSegmentRuleSatisfiability(
        all(
          compare('age', 'eq', 'abc'),
          compare('age', 'eq', 40),
          compare('unknownField' as AudienceFieldKey, 'eq', 'x'),
        ),
      ).findings,
    ).toHaveLength(0);

    expect(
      analyzeSegmentRuleSatisfiability(
        all(any(compare('cityTier', 'eq', 'tier1'), compare('cityTier', 'eq', 'tier2'))),
      ).findings,
    ).toHaveLength(0);

    expect(
      analyzeSegmentRuleSatisfiability(
        all(
          not(all(compare('cityTier', 'eq', 'tier1'), compare('lastActiveDaysAgo', 'gt', 30))),
          compare('cityTier', 'eq', 'tier2'),
        ),
      ).findings,
    ).toHaveLength(0);
  });

  it('可满足的常规规则不产生任何结论', () => {
    const result = analyzeSegmentRuleSatisfiability(
      all(
        compare('vipLevel', 'in', ['gold', 'platinum']),
        compare('lastPurchaseDaysAgo', 'gt', 90),
        not(compare('isBlacklisted', 'eq', true)),
      ),
    );
    expect(result.findings).toHaveLength(0);
    expect(result.rootUnsatisfiable).toBe(false);
    expect(result.rootAlwaysTrue).toBe(false);
  });
});
