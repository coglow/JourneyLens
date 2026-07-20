import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { segmentRuleSchema, type SegmentRule } from '@journeylens/shared';
import { RuleTreeEditor } from './RuleTreeEditor';

function nestedGroups(depth: number): SegmentRule {
  let rule: SegmentRule = { kind: 'all', children: [] };
  for (let level = 1; level < depth; level += 1) {
    rule = { kind: 'all', children: [rule] };
  }
  return rule;
}

afterEach(() => {
  cleanup();
});

describe('分群规则编辑器', () => {
  it('编辑空规则时可以添加一个条件', () => {
    function Harness() {
      const [rules, setRules] = useState<SegmentRule>({ kind: 'all', children: [] });
      return <RuleTreeEditor value={rules} onChange={setRules} />;
    }

    render(
      <ConfigProvider locale={zhCN}>
        <Harness />
      </ConfigProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /添加条件$/ }));

    expect(screen.getByLabelText('条件 1用户属性')).toBeTruthy();
    expect(screen.getByLabelText('条件 1比较方式')).toBeTruthy();
    expect(screen.getByLabelText('条件 1比较值')).toBeTruthy();
  });

  it('修改排除组中的条件时整树复制，未修改分支也不再引用旧状态', () => {
    const city = {
      kind: 'compare' as const,
      left: { source: 'user' as const, path: 'cityTier' as const },
      operator: 'in' as const,
      right: ['tier2'],
    };
    const rules: SegmentRule = {
      kind: 'all',
      children: [
        city,
        {
          kind: 'not',
          child: {
            kind: 'all',
            children: [
              {
                kind: 'compare',
                left: { source: 'user', path: 'displayName' },
                operator: 'eq',
                right: '小明',
              },
            ],
          },
        },
      ],
    };
    const original = structuredClone(rules);
    const onChange = vi.fn<(rule: SegmentRule) => void>();
    render(<RuleTreeEditor value={rules} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('条件 2.1比较值'), { target: { value: '小红' } });

    const next = onChange.mock.calls[0]?.[0];
    if (next?.kind !== 'all') throw new Error('更新后应保留根条件组');
    const copiedCity = next.children[0];
    if (copiedCity?.kind !== 'compare') throw new Error('更新后应保留城市条件');
    expect(next).not.toBe(rules);
    expect(copiedCity).toEqual(city);
    expect(copiedCity).not.toBe(city);
    expect(copiedCity.left).not.toBe(city.left);
    expect(copiedCity.right).not.toBe(city.right);
    expect(next.children[1]).toMatchObject({
      child: { children: [{ right: '小红' }] },
    });
    expect(rules).toEqual(original);
  });

  it('切换根组逻辑只修改副本，保留原来的全部满足设置', () => {
    const rules: SegmentRule = { kind: 'all', children: [] };
    const onChange = vi.fn();
    render(<RuleTreeEditor value={rules} onChange={onChange} />);

    fireEvent.click(screen.getByRole('radio', { name: '任一满足' }));

    expect(onChange).toHaveBeenCalledWith({ kind: 'any', children: [] });
    expect(rules).toEqual({ kind: 'all', children: [] });
  });

  it('删除排除组内的条件只改变副本，保留其余条件和原树', () => {
    const age: SegmentRule = {
      kind: 'compare',
      left: { source: 'user', path: 'age' },
      operator: 'gte',
      right: 18,
    };
    const city: SegmentRule = {
      kind: 'compare',
      left: { source: 'user', path: 'cityTier' },
      operator: 'in',
      right: ['tier2'],
    };
    const rules: SegmentRule = {
      kind: 'not',
      child: { kind: 'all', children: [age, city] },
    };
    const original = structuredClone(rules);
    const onChange = vi.fn();
    render(<RuleTreeEditor value={rules} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '删除条件 1' }));

    expect(onChange).toHaveBeenCalledWith({
      kind: 'not',
      child: { kind: 'all', children: [city] },
    });
    expect(rules).toEqual(original);
  });

  it('切换用户属性和比较方式时清空旧比较值，原树不变', async () => {
    const rules: SegmentRule = {
      kind: 'compare',
      left: { source: 'user', path: 'age' },
      operator: 'gte',
      right: 18,
    };
    const original = structuredClone(rules);
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState(rules);
      return (
        <RuleTreeEditor
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      );
    }
    render(<Harness />);

    fireEvent.mouseDown(screen.getByLabelText('规则用户属性'));
    const dropdown = document.querySelector('.ant-select-dropdown') as HTMLElement;
    fireEvent.click(within(dropdown).getByTitle('邮箱'));
    expect((screen.getByLabelText('规则比较值') as HTMLInputElement).value).toBe('');

    fireEvent.change(screen.getByLabelText('规则比较值'), {
      target: { value: 'operator@example.com' },
    });
    fireEvent.mouseDown(screen.getByLabelText('规则比较方式'));
    fireEvent.click(await screen.findByTitle('包含'));

    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'compare',
      left: { source: 'user', path: 'email' },
      operator: 'contains',
    });
    expect((screen.getByLabelText('规则比较值') as HTMLInputElement).value).toBe('');
    expect(rules).toEqual(original);
  });

  it.each([
    { depth: 3, condition: true, group: true, exclusion: true },
    { depth: 4, condition: true, group: true, exclusion: false },
    { depth: 5, condition: true, group: false, exclusion: false },
    { depth: 6, condition: false, group: false, exclusion: false },
  ])('第 $depth 层只允许添加能够补全的规则', ({ depth, condition, group, exclusion }) => {
    render(<RuleTreeEditor value={nestedGroups(depth)} onChange={vi.fn()} />);
    const editor = within(screen.getByText('添加一个条件开始设置').parentElement!);

    for (const [name, enabled] of [
      ['添加条件', condition],
      ['添加条件组', group],
      ['添加排除组', exclusion],
    ] as const) {
      expect(
        (editor.getByRole('button', { name: new RegExp(`${name}$`) }) as HTMLButtonElement)
          .disabled,
      ).toBe(!enabled);
    }
  });

  it.each([
    { depth: 5, action: '添加条件' },
    { depth: 4, action: '添加条件组' },
    { depth: 3, action: '添加排除组' },
  ])('第 $depth 层使用 $action 可以补全至第六层并通过校验', ({ depth, action }) => {
    const onChange = vi.fn<(rule: SegmentRule) => void>();
    function Harness() {
      const [rules, setRules] = useState(() => nestedGroups(depth));
      return (
        <RuleTreeEditor
          value={rules}
          onChange={(next) => {
            setRules(next);
            onChange(next);
          }}
        />
      );
    }
    render(<Harness />);
    const emptyGroup = () => within(screen.getByText('添加一个条件开始设置').parentElement!);

    if (action !== '添加条件') {
      fireEvent.click(emptyGroup().getByRole('button', { name: new RegExp(`${action}$`) }));
    }
    fireEvent.click(emptyGroup().getByRole('button', { name: /添加条件$/ }));
    fireEvent.change(screen.getByLabelText(/比较值$/), { target: { value: '嵌套边界验收' } });

    expect(segmentRuleSchema.safeParse(onChange.mock.calls.at(-1)?.[0]).success).toBe(true);
  });

  it('接近一百个节点时仍为新增组内的条件预留位置，并允许添加最后一个普通条件', () => {
    function rulesWithNodes(total: number): SegmentRule {
      const groups = Array.from({ length: 5 }, () => ({
        kind: 'any' as const,
        children: [] as SegmentRule[],
      }));
      for (let index = 0; index < total - 7; index += 1) {
        groups[Math.floor(index / 19)]!.children.push({
          kind: 'compare',
          left: { source: 'user', path: 'age' },
          operator: 'exists',
        });
      }
      return { kind: 'all', children: [{ kind: 'all', children: [] }, ...groups] };
    }
    const onChange = vi.fn();
    const { rerender } = render(<RuleTreeEditor value={rulesWithNodes(97)} onChange={onChange} />);

    for (const [nodes, condition, group, exclusion] of [
      [97, true, true, true],
      [98, true, true, false],
      [99, true, false, false],
      [100, false, false, false],
    ] as const) {
      rerender(<RuleTreeEditor value={rulesWithNodes(nodes)} onChange={onChange} />);
      const editor = within(screen.getByText('添加一个条件开始设置').parentElement!);
      for (const [name, enabled] of [
        ['添加条件', condition],
        ['添加条件组', group],
        ['添加排除组', exclusion],
      ] as const) {
        expect(
          (editor.getByRole('button', { name: new RegExp(`${name}$`) }) as HTMLButtonElement)
            .disabled,
        ).toBe(!enabled);
      }
    }
  });

  it('对整体矛盾发出阻止保存的提醒，并定位到参与条件', () => {
    const rules: SegmentRule = {
      kind: 'all',
      children: [
        {
          kind: 'compare',
          left: { source: 'user', path: 'age' },
          operator: 'gt',
          right: 30,
        },
        {
          kind: 'compare',
          left: { source: 'user', path: 'age' },
          operator: 'lt',
          right: 20,
        },
      ],
    };
    render(<RuleTreeEditor value={rules} onChange={vi.fn()} />);

    const conflictAlert = screen.getByText('分群条件互相矛盾');
    expect(conflictAlert.closest('.ant-alert-warning')).not.toBeNull();
    expect(document.getElementById('segment-rule-root')?.className).not.toContain('conflicted');
    const firstCondition = document.getElementById('segment-rule-children-0');
    const secondCondition = document.getElementById('segment-rule-children-1');
    expect(firstCondition?.className).toContain('conflicted');
    expect(secondCondition?.className).toContain('conflicted');
    fireEvent.click(screen.getByRole('button', { name: /定位条件/ }));
    expect(document.activeElement).toBe(firstCondition);
  });

  it('解释城市层级的选中和排除冲突，显示中文并保留定位', () => {
    const condition: SegmentRule = {
      kind: 'compare',
      left: { source: 'user', path: 'cityTier' },
      operator: 'in',
      right: ['tier2'],
    };
    render(
      <RuleTreeEditor
        value={{
          kind: 'all',
          children: [condition, { kind: 'not', child: { kind: 'all', children: [condition] } }],
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('分群条件互相矛盾')).toBeTruthy();
    expect(
      screen.getByText(
        '你选择了“城市层级为二线城市”，同时又排除了二线城市用户。这两项条件无法同时满足，请修改其中一项。',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/tier2|不满足：/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /定位条件/ }));
    expect(document.activeElement).toBe(document.getElementById('segment-rule-children-0'));
  });

  it('枚举多选使用下拉选择，条件组可切换全部满足和任一满足', () => {
    const rules: SegmentRule = {
      kind: 'all',
      children: [
        {
          kind: 'compare',
          left: { source: 'user', path: 'vipLevel' },
          operator: 'in',
          right: ['gold'],
        },
      ],
    };
    function Harness() {
      const [value, setValue] = useState(rules);
      return <RuleTreeEditor value={value} onChange={setValue} />;
    }
    render(
      <ConfigProvider locale={zhCN}>
        <Harness />
      </ConfigProvider>,
    );

    fireEvent.mouseDown(screen.getByLabelText('条件 1比较值'));
    const dropdown = document.querySelector('.ant-select-dropdown') as HTMLElement;
    expect(within(dropdown).getByTitle('黄金').className).toContain(
      'ant-select-item-option-selected',
    );
    fireEvent.click(within(dropdown).getByTitle('铂金'));
    expect(within(dropdown).getByTitle('铂金').className).toContain(
      'ant-select-item-option-selected',
    );
    fireEvent.click(screen.getByRole('radio', { name: '任一满足' }));
    expect(screen.getByRole('radio', { name: '任一满足' }) as HTMLInputElement).toBeTruthy();
  });

  it('兴趣标签的可选值支持搜索', () => {
    const rules: SegmentRule = {
      kind: 'all',
      children: [
        {
          kind: 'compare',
          left: { source: 'user', path: 'interests' },
          operator: 'contains',
          right: '数码',
        },
      ],
    };
    render(
      <ConfigProvider locale={zhCN}>
        <RuleTreeEditor value={rules} onChange={vi.fn()} />
      </ConfigProvider>,
    );

    const valueInput = screen.getByLabelText('条件 1比较值');
    fireEvent.mouseDown(valueInput);
    fireEvent.change(valueInput, { target: { value: '智' } });

    const dropdown = document.querySelector('.ant-select-dropdown') as HTMLElement;
    expect(within(dropdown).getByTitle('智能家居')).toBeTruthy();
    expect(within(dropdown).queryByTitle('数码')).toBeNull();
  });

  it('保留可命中分支时，只提示局部矛盾，不把整条规则判为不可保存', () => {
    const rules: SegmentRule = {
      kind: 'any',
      children: [
        {
          kind: 'all',
          children: [
            { kind: 'compare', left: { source: 'user', path: 'age' }, operator: 'gt', right: 30 },
            { kind: 'compare', left: { source: 'user', path: 'age' }, operator: 'lt', right: 20 },
          ],
        },
        { kind: 'compare', left: { source: 'user', path: 'age' }, operator: 'gte', right: 0 },
      ],
    };
    render(<RuleTreeEditor value={rules} onChange={vi.fn()} />);

    expect(screen.getByText('这组条件互相矛盾，分群仍可保存')).toBeTruthy();
    expect(document.getElementById('segment-rule-root')?.className).not.toContain('conflicted');
    const conflictingGroup = document.getElementById('segment-rule-children-0');
    expect(conflictingGroup?.className).not.toContain('conflicted');
    expect(document.getElementById('segment-rule-children-0-children-0')?.className).toContain(
      'conflicted',
    );
    expect(document.getElementById('segment-rule-children-0-children-1')?.className).toContain(
      'conflicted',
    );
  });

  it('删除非空条件组前需要确认，取消后保留、确认后删除', () => {
    const rules: SegmentRule = {
      kind: 'all',
      children: [
        {
          kind: 'any',
          children: [
            { kind: 'compare', left: { source: 'user', path: 'age' }, operator: 'gte', right: 20 },
          ],
        },
      ],
    };
    function Harness() {
      const [value, setValue] = useState(rules);
      return <RuleTreeEditor value={value} onChange={setValue} />;
    }
    render(
      <ConfigProvider locale={zhCN}>
        <Harness />
      </ConfigProvider>,
    );

    const trigger = screen.getByRole('button', { name: '删除条件组' });
    fireEvent.click(trigger);
    const popup = document.querySelector('.ant-popconfirm') as HTMLElement;
    expect(within(popup).getByText('删除条件组？')).toBeTruthy();
    expect(within(popup).getByText('组内条件也会一起删除。')).toBeTruthy();
    // antd 会给两字中文按钮自动加空格，文案按去掉空格后的正则匹配。
    fireEvent.click(within(popup).getByRole('button', { name: /^保\s*留$/ }));
    expect(screen.queryByText('添加一个条件开始设置')).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(within(popup).getByRole('button', { name: /^删\s*除$/ }));
    expect(screen.getByText('添加一个条件开始设置')).toBeTruthy();
  });

  it('有内容的排除组删除前需要确认，取消后保留分组', () => {
    const rules: SegmentRule = {
      kind: 'all',
      children: [
        {
          kind: 'not',
          child: {
            kind: 'all',
            children: [
              {
                kind: 'compare',
                left: { source: 'user', path: 'age' },
                operator: 'gte',
                right: 20,
              },
            ],
          },
        },
      ],
    };
    function Harness() {
      const [value, setValue] = useState(rules);
      return <RuleTreeEditor value={value} onChange={setValue} />;
    }
    render(
      <ConfigProvider locale={zhCN}>
        <Harness />
      </ConfigProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '删除排除组' }));
    const popup = document.querySelector('.ant-popconfirm') as HTMLElement;
    expect(within(popup).getByText('删除排除组？')).toBeTruthy();
    fireEvent.click(within(popup).getByRole('button', { name: /^保\s*留$/ }));
    expect(screen.getByText('排除满足以下条件的用户')).toBeTruthy();
  });

  it('删除空排除组时不需要确认，直接移除', () => {
    const rules: SegmentRule = {
      kind: 'all',
      children: [{ kind: 'not', child: { kind: 'all', children: [] } }],
    };
    const onChange = vi.fn<(rule: SegmentRule) => void>();
    function Harness() {
      const [value, setValue] = useState(rules);
      return (
        <RuleTreeEditor
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      );
    }
    render(
      <ConfigProvider locale={zhCN}>
        <Harness />
      </ConfigProvider>,
    );

    expect(screen.getByText('排除满足以下条件的用户')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除排除组' }));
    expect(screen.queryByText('删除排除组？')).toBeNull();
    expect(screen.queryByText('排除满足以下条件的用户')).toBeNull();
    expect(onChange).toHaveBeenCalledWith({ kind: 'all', children: [] });
  });
});
