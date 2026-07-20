import { describe, expect, it } from 'vitest';
import { getSegmentComparisonLabels } from './segment-comparison.js';
import type { SegmentRuleCompare } from './segment-rule.js';

function compare(
  left: SegmentRuleCompare['left'],
  operator: SegmentRuleCompare['operator'],
  right?: SegmentRuleCompare['right'],
): SegmentRuleCompare {
  const rule: SegmentRuleCompare = { kind: 'compare', left, operator };
  return right === undefined ? rule : { ...rule, right };
}

describe('分群比较条件文案', () => {
  it('多值条件复用属性目录和枚举文案', () => {
    expect(
      getSegmentComparisonLabels(
        compare({ source: 'user', path: 'vipLevel' }, 'in', ['gold', 'platinum']),
      ),
    ).toEqual({
      fieldLabel: '会员等级',
      operatorLabel: '属于',
      valueText: '黄金、铂金',
    });
  });

  it('已填写条件没有比较值', () => {
    expect(
      getSegmentComparisonLabels(compare({ source: 'user', path: 'email' }, 'exists')),
    ).toEqual({
      fieldLabel: '邮箱',
      operatorLabel: '已填写',
      valueText: '',
    });
  });

  it('布尔比较值沿用是／否文案', () => {
    expect(
      getSegmentComparisonLabels(compare({ source: 'user', path: 'optInSms' }, 'eq', true)),
    ).toEqual({
      fieldLabel: '短信订阅',
      operatorLabel: '等于',
      valueText: '是',
    });
  });
});
