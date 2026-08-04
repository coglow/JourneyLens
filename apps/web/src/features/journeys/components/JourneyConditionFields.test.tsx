import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { JourneyConditionRule } from '@journeylens/shared';
import { JourneyConditionFields, JourneyEventFilterFields } from './JourneyConditionFields';

afterEach(cleanup);

const countRule: JourneyConditionRule = {
  kind: 'event_count',
  eventType: 'purchase_completed',
  windowSeconds: 7 * 24 * 60 * 60,
  sameProduct: false,
  operator: 'gte',
  right: 1,
};

function Harness() {
  const [value, setValue] = useState<JourneyConditionRule>(countRule);
  return (
    <>
      <JourneyConditionFields value={value} startBehavior="product_viewed" onChange={setValue} />
      <output data-testid="rule">{JSON.stringify(value)}</output>
    </>
  );
}

function currentRule(): JourneyConditionRule {
  return JSON.parse(screen.getByTestId('rule').textContent!) as JourneyConditionRule;
}

describe('旅程条件字段', () => {
  it('清空数字输入时保留上一次的有效值，不写入 0 或 -1', () => {
    render(<Harness />);
    const rightInput = screen.getByRole('spinbutton', { name: '比较次数' }) as HTMLInputElement;
    fireEvent.change(rightInput, { target: { value: '3' } });
    expect(currentRule()).toMatchObject({ right: 3 });
    fireEvent.change(rightInput, { target: { value: '' } });
    fireEvent.blur(rightInput);
    expect(currentRule()).toMatchObject({ right: 3 });
    expect(rightInput.value).toBe('3');

    const windowInput = screen.getByRole('spinbutton', {
      name: '统计时间窗口（秒）',
    }) as HTMLInputElement;
    fireEvent.change(windowInput, { target: { value: '60' } });
    expect(currentRule()).toMatchObject({ windowSeconds: 60 });
    fireEvent.change(windowInput, { target: { value: '' } });
    fireEvent.blur(windowInput);
    expect(currentRule()).toMatchObject({ windowSeconds: 60 });
    expect(windowInput.value).toBe('60');
  });

  it('行为没有可筛选属性时禁用筛选开关并说明原因', () => {
    const onChange = vi.fn();
    render(
      <JourneyEventFilterFields
        eventType="registration_completed"
        value={undefined}
        label="次数过滤"
        onChange={onChange}
      />,
    );
    const filterSwitch = screen.getByRole('checkbox', {
      name: '按行为属性筛选',
    }) as HTMLInputElement;
    expect(filterSwitch.disabled).toBe(true);
    expect(screen.getByText('该行为没有可筛选的属性。')).toBeTruthy();
    fireEvent.click(filterSwitch);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('行为有属性时筛选开关可用，打开后带出默认属性', () => {
    const onChange = vi.fn();
    render(
      <JourneyEventFilterFields
        eventType="product_viewed"
        value={undefined}
        label="次数过滤"
        onChange={onChange}
      />,
    );
    const filterSwitch = screen.getByRole('checkbox', {
      name: '按行为属性筛选',
    }) as HTMLInputElement;
    expect(filterSwitch.disabled).toBe(false);
    expect(screen.queryByText('该行为没有可筛选的属性。')).toBeNull();
    fireEvent.click(filterSwitch);
    expect(onChange).toHaveBeenCalledWith({ path: 'productId', operator: 'exists' });
  });
});

describe('行为属性比较选项', () => {
  it('进入行为的商品类目只提供单值比较方式', async () => {
    render(
      <JourneyConditionFields
        value={{
          kind: 'compare',
          left: { source: 'entry_event', eventType: 'product_viewed', path: 'category' },
          operator: 'eq',
          right: 'electronics',
        }}
        startBehavior="product_viewed"
        onChange={vi.fn()}
      />,
    );
    fireEvent.mouseDown(screen.getByLabelText('旅程条件比较方式'));
    const list = await screen.findByRole('listbox');
    expect(within(list).getByRole('option', { name: /^等于$/ })).toBeTruthy();
    expect(within(list).getByRole('option', { name: /^不等于$/ })).toBeTruthy();
    expect(within(list).queryByRole('option', { name: /^属于$/ })).toBeNull();
  });

  it('行为筛选切换到价格后提供数字比较方式', async () => {
    const onChange = vi.fn();
    render(
      <JourneyEventFilterFields
        eventType="product_viewed"
        value={{ path: 'price', operator: 'gte', right: 2000 }}
        label="筛选"
        onChange={onChange}
      />,
    );
    fireEvent.mouseDown(screen.getByLabelText('筛选比较方式'));
    fireEvent.click(
      await screen.findByText('小于等于', { selector: '.ant-select-item-option-content' }),
    );
    expect(onChange).toHaveBeenCalledWith({ path: 'price', operator: 'lte', right: undefined });
  });
});
