import { describe, expect, it } from 'vitest';
import type { SegmentRule } from '@journeylens/shared';
import { summarizeSegmentRule } from './segment-rules';

describe('分群规则展示', () => {
  it('按属性目录生成嵌套规则摘要和枚举文案', () => {
    const rule: SegmentRule = {
      kind: 'all',
      children: [
        {
          kind: 'compare',
          left: { source: 'user', path: 'age' },
          operator: 'gte',
          right: 30,
        },
        {
          kind: 'any',
          children: [
            {
              kind: 'compare',
              left: { source: 'user', path: 'gender' },
              operator: 'eq',
              right: 'female',
            },
            {
              kind: 'not',
              child: {
                kind: 'compare',
                left: { source: 'user', path: 'isBlacklisted' },
                operator: 'eq',
                right: true,
              },
            },
          ],
        },
      ],
    };

    expect(summarizeSegmentRule(rule)).toBe(
      '（年龄 大于等于 30） 且 （（性别 等于 女） 或 非（黑名单标记 等于 是））',
    );
  });

  it('嵌套组保留分组括号，单项嵌套不额外加括号', () => {
    const exists = (path: 'age' | 'cityTier' | 'gender'): SegmentRule => ({
      kind: 'compare',
      left: { source: 'user', path },
      operator: 'exists',
    });

    expect(
      summarizeSegmentRule({
        kind: 'any',
        children: [
          { kind: 'all', children: [exists('age'), exists('cityTier')] },
          exists('gender'),
        ],
      }),
    ).toBe('（（年龄 已填写） 且 （城市层级 已填写）） 或 （性别 已填写）');

    expect(
      summarizeSegmentRule({ kind: 'all', children: [{ kind: 'any', children: [exists('age')] }] }),
    ).toBe('（年龄 已填写）');
  });

  it('组内条件逐项加括号，根节点单个条件不加', () => {
    const exists = (path: 'age' | 'cityTier' | 'gender'): SegmentRule => ({
      kind: 'compare',
      left: { source: 'user', path },
      operator: 'exists',
    });

    expect(
      summarizeSegmentRule({
        kind: 'all',
        children: [exists('age'), exists('cityTier'), exists('gender')],
      }),
    ).toBe('（年龄 已填写） 且 （城市层级 已填写） 且 （性别 已填写）');

    expect(summarizeSegmentRule({ kind: 'all', children: [exists('age'), exists('gender')] })).toBe(
      '（年龄 已填写） 且 （性别 已填写）',
    );

    expect(summarizeSegmentRule(exists('age'))).toBe('年龄 已填写');
  });
});
