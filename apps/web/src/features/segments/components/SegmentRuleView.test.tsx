import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SegmentRule } from '@journeylens/shared';
import { SegmentRuleView } from './SegmentRuleView';

const rules: SegmentRule = {
  kind: 'all',
  children: [
    {
      kind: 'compare',
      left: { source: 'user', path: 'vipLevel' },
      operator: 'in',
      right: ['gold', 'platinum'],
    },
    {
      kind: 'any',
      children: [
        {
          kind: 'compare',
          left: { source: 'user', path: 'city' },
          operator: 'eq',
          right: '上海',
        },
        {
          kind: 'compare',
          left: { source: 'user', path: 'city' },
          operator: 'eq',
          right: '杭州',
        },
      ],
    },
    {
      kind: 'not',
      child: {
        kind: 'all',
        children: [
          {
            kind: 'compare',
            left: { source: 'user', path: 'isBlacklisted' },
            operator: 'eq',
            right: true,
          },
        ],
      },
    },
  ],
};

describe('分群规则只读视图', () => {
  it('显示嵌套逻辑、目录名称、枚举值和排除条件', () => {
    render(<SegmentRuleView rules={rules} />);

    expect(screen.getByText('全部满足')).toBeTruthy();
    expect(screen.getByText('会员等级')).toBeTruthy();
    expect(screen.getByText('黄金、铂金')).toBeTruthy();
    expect(screen.getByText('任一满足')).toBeTruthy();
    expect(screen.getByText('上海')).toBeTruthy();
    expect(screen.getByText('杭州')).toBeTruthy();
    expect(screen.getByText('排除')).toBeTruthy();
    expect(screen.getByText('满足以下全部条件的用户')).toBeTruthy();
    expect(screen.getByText('黑名单标记')).toBeTruthy();
    expect(screen.getByText('是')).toBeTruthy();
  });
});
