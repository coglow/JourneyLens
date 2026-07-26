import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { journeySimulationScenarioSchema } from '@journeylens/shared';
import { createDefaultSimulationScenario } from '@/features/journeys/hooks/useJourneySimulation';
import { SimulationScenarioEditor } from './SimulationScenarioEditor';

afterEach(cleanup);

function Harness() {
  const [scenario, setScenario] = useState(createDefaultSimulationScenario);
  return (
    <>
      <SimulationScenarioEditor
        open
        scenario={scenario}
        setScenario={setScenario}
        errors={[]}
        suggestedUserFields={['age', 'vipLevel']}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />
      <output data-testid="scenario">{JSON.stringify(scenario)}</output>
    </>
  );
}

function currentScenario() {
  return journeySimulationScenarioSchema.parse(
    JSON.parse(screen.getByTestId('scenario').textContent!),
  );
}

async function addField(label: string) {
  fireEvent.click(screen.getByRole('button', { name: '添加用户属性' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
}

async function fieldAction(label: string, action: string) {
  fireEvent.click(screen.getByRole('button', { name: `${label}的更多操作` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: action }));
}

describe('模拟资料编辑', () => {
  it('新增属性立即可填，复选框可切换空值，且支持输入零', async () => {
    render(<Harness />);
    expect(screen.getByRole('checkbox', { name: '昵称设为空值' })).toBeTruthy();
    await addField('累计订单数');
    const input = screen.getByRole('spinbutton', { name: '累计订单数' });
    expect((input as HTMLInputElement).disabled).toBe(false);
    expect(currentScenario().user.attributes).not.toHaveProperty('totalOrders');
    const emptyCheckbox = screen.getByRole('checkbox', { name: '累计订单数设为空值' });
    expect(screen.queryByRole('button', { name: '累计订单数的更多操作' })).toBeNull();
    fireEvent.click(emptyCheckbox);
    expect(currentScenario().user.attributes.totalOrders).toBeNull();
    expect((emptyCheckbox as HTMLInputElement).checked).toBe(true);
    expect((input as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(emptyCheckbox);
    expect(currentScenario().user.attributes).not.toHaveProperty('totalOrders');
    expect((input as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(screen.getByRole('spinbutton', { name: '累计订单数' }), {
      target: { value: '0' },
    });
    expect(currentScenario().user.attributes.totalOrders).toBe(0);
  });

  it('邮箱清空后仍可继续填写，空值复选框单独锁定输入', () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: '邮箱' });
    const emptyCheckbox = within(group).getByRole('checkbox', { name: '邮箱设为空值' });
    expect((emptyCheckbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(emptyCheckbox);
    const input = within(group).getByRole('textbox', { name: '邮箱' });
    expect((input as HTMLInputElement).disabled).toBe(false);
    expect(currentScenario().user.email).toBeNull();
    fireEvent.change(input, { target: { value: 'demo@example.com' } });
    expect(currentScenario().user.email).toBe('demo@example.com');
    fireEvent.change(input, { target: { value: '' } });
    expect(currentScenario().user.email).toBeNull();
    expect((emptyCheckbox as HTMLInputElement).checked).toBe(false);
    expect((input as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(input, { target: { value: 'next@example.com' } });
    expect(currentScenario().user.email).toBe('next@example.com');
    fireEvent.click(emptyCheckbox);
    expect(currentScenario().user.email).toBeNull();
    expect((emptyCheckbox as HTMLInputElement).checked).toBe(true);
    expect((input as HTMLInputElement).disabled).toBe(true);
  });

  it('空列表和空值保持区别，取消空值后仍保留字段入口', async () => {
    render(<Harness />);
    await addField('兴趣标签');
    await fieldAction('兴趣标签', '设为空列表');
    expect(currentScenario().user.attributes.interests).toEqual([]);
    expect(
      within(screen.getByRole('group', { name: '兴趣标签' })).getByText('空列表'),
    ).toBeTruthy();
    const emptyCheckbox = screen.getByRole('checkbox', { name: '兴趣标签设为空值' });
    fireEvent.click(emptyCheckbox);
    expect(currentScenario().user.attributes.interests).toBeNull();
    fireEvent.click(emptyCheckbox);
    expect(currentScenario().user.attributes).not.toHaveProperty('interests');
    expect(screen.getByRole('combobox', { name: '兴趣标签' })).toBeTruthy();
  });

  it('四个页签编辑对应资料，保留进入、历史与后续行为的边界', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: '进入行为' }));
    fireEvent.change(screen.getByRole('textbox', { name: '商品编号' }), {
      target: { value: 'P-ENTRY' },
    });
    fireEvent.click(screen.getByRole('tab', { name: '历史行为（1）' }));
    const historicalTime = screen.getByRole('spinbutton', {
      name: '历史行为 1 进入前的时间数值',
    });
    expect((historicalTime as HTMLInputElement).value).toBe('2');
    fireEvent.change(historicalTime, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('tab', { name: '后续行为（1）' }));
    const scheduledTime = screen.getByRole('spinbutton', {
      name: '后续行为 1 进入后的时间数值',
    });
    fireEvent.mouseDown(screen.getByLabelText('后续行为 1 进入后的时间单位'));
    fireEvent.click(screen.getByText('分钟'));
    expect((scheduledTime as HTMLInputElement).value).toBe('2');
    expect(currentScenario().scheduledEvents[0]!.offsetSeconds).toBe(120);
    fireEvent.change(scheduledTime, { target: { value: '0' } });
    const scenario = currentScenario();
    expect(scenario.entryEvent.payload.productId).toBe('P-ENTRY');
    expect(scenario.historicalEvents[0]!.offsetSeconds).toBe(-86_400);
    expect(scenario.historicalEvents[0]!.payload.productId).toBe('P-200');
    expect(scenario.scheduledEvents[0]!.offsetSeconds).toBe(0);
    expect(scenario.scheduledEvents[0]!.payload.productId).toBe('P-100');
    fireEvent.click(screen.getByRole('tab', { name: '用户资料' }));
    expect(screen.queryByRole('button', { name: '载入已有受众' })).toBeNull();
  });
});
