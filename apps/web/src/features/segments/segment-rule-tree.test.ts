import { describe, expect, it } from 'vitest';
import type { SegmentRule } from '@journeylens/shared';
import { countRuleNodes, ruleDepthAtPath, rulePathId } from './segment-rule-tree';

describe('分群规则树操作', () => {
  it('提供规则节点数、层数和可用于定位的稳定元素标识', () => {
    const rule: SegmentRule = {
      kind: 'all',
      children: [
        {
          kind: 'not',
          child: {
            kind: 'compare',
            left: { source: 'user', path: 'age' },
            operator: 'gt',
            right: 18,
          },
        },
      ],
    };

    expect(countRuleNodes(rule)).toBe(3);
    expect(ruleDepthAtPath(rule, ['children', 0, 'child'])).toBe(3);
    expect(rulePathId(['children', 0, 'child'])).toBe('segment-rule-children-0-child');
  });
});
