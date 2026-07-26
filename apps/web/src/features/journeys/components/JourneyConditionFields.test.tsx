import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
