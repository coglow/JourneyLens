import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  journeyDraftDefinitionSchema,
  type JourneySimulationResult,
  type JourneySimulationScenario,
  type SimulationEvidenceValue,
} from '@journeylens/shared';
import type { JourneySimulationController } from '@/features/journeys/hooks/useJourneySimulation';
import { createDefaultSimulationScenario } from '@/features/journeys/hooks/useJourneySimulation';
import { JourneySimulationPanel } from './JourneySimulationPanel';

afterEach(cleanup);

const definition = journeyDraftDefinitionSchema.parse({
  layoutDirection: 'vertical',
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: '开始',
      position: { x: 0, y: 0 },
      entryBehavior: 'product_viewed',
    },
    { id: 'end', type: 'end', name: '结束', position: { x: 0, y: 100 }, note: null },
  ],
  edges: [{ id: 'edge', source: 'start', target: 'end' }],
});

function makeResult(scenario: JourneySimulationScenario): JourneySimulationResult {
  return {
    outcome: 'completed',
    user: { displayName: scenario.user.displayName },
    admission: {
      entryBehavior: {
        expected: 'product_viewed',
        actual: 'product_viewed',
        matched: true,
      },
      segment: null,
    },
    steps: [
      {
        order: 1,
        nodeId: 'start',
        nodeName: '开始',
        nodeType: 'start',
        entryBehavior: 'product_viewed',
        elapsedSeconds: 0,
      },
      {
        order: 2,
        nodeId: 'end',
        nodeName: '结束',
        nodeType: 'end',
        note: null,
        elapsedSeconds: 0,
      },
    ],
    traversedEdgeIds: ['edge'],
    elapsedSeconds: 0,
  };
}

function makeController(
  overrides: Partial<JourneySimulationController> = {},
): JourneySimulationController {
  const scenario = createDefaultSimulationScenario('product_viewed');
  return {
    scenario,
    setScenario: vi.fn(),
    scenarioErrors: [],
    resetScenario: vi.fn(),
    result: null,
    visibleStepCount: 0,
    pending: false,
    error: undefined,
    stale: false,
    start: vi.fn(async () => undefined),
    ...overrides,
  } as JourneySimulationController;
}

function renderPanel(simulation = makeController()) {
  return render(
    <JourneySimulationPanel
      journeyId="journey-1"
      definition={definition}
      segmentRules={null}
      simulation={simulation}
      onLocate={vi.fn()}
    />,
  );
}

describe('旅程模拟面板', () => {
  it('不需要选择数据库受众即可开始，编辑窗口包含用户和行为输入', () => {
    const simulation = makeController();
    renderPanel(simulation);

    expect((screen.getByRole('button', { name: '开始模拟' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: '编辑模拟资料' }));
    expect(screen.getByRole('dialog', { name: '编辑模拟资料' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '载入已有受众' })).toBeNull();
    expect(screen.getByRole('tab', { name: '用户资料' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '进入行为' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /历史行为/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /后续行为/ })).toBeTruthy();
  });

  it('默认显示资料摘要，展开后能查看完整用户资料和各类行为', () => {
    const simulation = makeController();
    simulation.scenario = {
      ...simulation.scenario,
      user: {
        ...simulation.scenario.user,
        email: 'zhang@example.com',
        attributes: { age: 25, optInSms: false },
      },
    };
    renderPanel(simulation);

    const summary = screen.getByRole('region', { name: '当前模拟资料' });
    expect(within(summary).getByText(/浏览商品 · 历史 1 条 · 后续 1 条/)).toBeTruthy();
    expect(within(summary).queryByText('zhang@example.com')).toBeNull();
    const disclosure = within(summary).getByRole('button', { name: /查看完整模拟资料/ });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(within(summary).getByText('zhang@example.com')).toBeTruthy();
    expect(within(summary).getByText('25')).toBeTruthy();
    expect(within(summary).getByText('否')).toBeTruthy();
    expect(within(summary).getByText(/浏览商品 · 进入时 商品 ID：P-100/)).toBeTruthy();
    expect(within(summary).getByText(/完成购买 · 进入前 2 天 商品 ID：P-200/)).toBeTruthy();
    expect(within(summary).getByText(/完成购买 · 进入后 2 小时 商品 ID：P-100/)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '编辑模拟资料' })).toBeNull();
  });

  it('展示计算结果并将节点定位交给编排页', () => {
    const simulation = makeController();
    const result = makeResult(simulation.scenario);
    const onLocate = vi.fn();
    render(
      <JourneySimulationPanel
        journeyId="journey-1"
        definition={definition}
        segmentRules={null}
        simulation={{ ...simulation, result, visibleStepCount: result.steps.length }}
        onLocate={onLocate}
      />,
    );

    expect(screen.getByText('已到达结束步骤')).toBeTruthy();
    expect(screen.queryByText(/经过 \d+ 步 · 累计等待/)).toBeNull();
    expect(screen.getByRole('list', { name: '模拟经过的步骤' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '定位' })[0]!);
    expect(onLocate).toHaveBeenCalledWith('start');
  });

  it('模拟期间显示进度并禁用按钮', () => {
    renderPanel(makeController({ pending: true }));

    const button = screen.getByRole('button', { name: /模拟中…/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('模拟中…');
    expect(screen.queryByRole('region', { name: '模拟结果' })).toBeNull();
  });

  it('播放时只展示已走过的步骤，尚未结束时不显示完成结论', () => {
    const simulation = makeController();
    renderPanel({
      ...simulation,
      pending: true,
      result: makeResult(simulation.scenario),
      visibleStepCount: 1,
    });

    expect(screen.getByText('正在模拟')).toBeTruthy();
    expect(screen.getByText('已走过 1 步 · 每步间隔 0.5 秒')).toBeTruthy();
    const steps = screen.getByRole('list', { name: '模拟经过的步骤' });
    expect(within(steps).getByText('开始')).toBeTruthy();
    expect(within(steps).queryByText('结束')).toBeNull();
    expect(screen.queryByText('已到达结束步骤')).toBeNull();
    expect(screen.queryByText('本次模拟已完成')).toBeNull();
  });

  it('相同结果重新模拟后仍显示本次完成提示', async () => {
    const simulation = makeController();
    const result = makeResult(simulation.scenario);
    let finish: ((value: JourneySimulationResult) => void) | undefined;
    const start = vi
      .fn()
      .mockResolvedValueOnce(result)
      .mockImplementationOnce(
        () =>
          new Promise<JourneySimulationResult>((resolve) => {
            finish = resolve;
          }),
      );
    renderPanel({ ...simulation, result, start, visibleStepCount: result.steps.length });

    fireEvent.click(screen.getByRole('button', { name: '重新模拟' }));
    expect(await screen.findByText('本次模拟已完成')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新模拟' }));
    await waitFor(() => expect(screen.queryByText('本次模拟已完成')).toBeNull());
    await act(async () => finish?.(result));
    expect(await screen.findByText('本次模拟已完成')).toBeTruthy();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('没有有效结果时不提示完成', async () => {
    const start = vi.fn(async () => undefined);
    renderPanel(makeController({ start }));

    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始模拟' })));
    expect(start).toHaveBeenCalledOnce();
    expect(screen.queryByText('本次模拟已完成')).toBeNull();
  });

  it.each<{
    path: 'vipLevel' | 'age' | 'optInSms';
    actual: SimulationEvidenceValue;
    summary: string;
  }>([
    { path: 'vipLevel', actual: { exists: false }, summary: '会员等级未填写 → 走「不满足」路径' },
    { path: 'age', actual: { exists: true, value: 0 }, summary: '年龄：0 → 走「不满足」路径' },
    {
      path: 'optInSms',
      actual: { exists: true, value: false },
      summary: '短信订阅：否 → 走「不满足」路径',
    },
  ])('直接显示判断证据，保留缺失、零和否的区别：$path', ({ path, actual, summary }) => {
    const simulation = makeController();
    const result = makeResult(simulation.scenario);
    result.steps.splice(1, 0, {
      order: 2,
      nodeId: 'condition',
      nodeName: '条件判断',
      nodeType: 'condition',
      elapsedSeconds: 0,
      rule: {
        kind: 'compare',
        left: { source: 'user', path },
        operator: path === 'age' ? 'gte' : path === 'optInSms' ? 'eq' : 'exists',
        ...(path === 'age' ? { right: 18 } : path === 'optInSms' ? { right: true } : {}),
      },
      matched: false,
      branch: 'unmet',
      evidence: { kind: 'value', actual },
    });
    renderPanel({ ...simulation, result, visibleStepCount: result.steps.length });
    expect(screen.getByText(summary)).toBeTruthy();
    const disclosure = screen.getByRole('button', { name: /查看判断详情/ });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(disclosure);
    expect(screen.getByText('判断来源')).toBeTruthy();
    expect(screen.getByText('实际值')).toBeTruthy();
  });

  it('未进入旅程时显示实际原因，准入依据仍可展开，不展示执行时间线', () => {
    const simulation = makeController();
    const result: JourneySimulationResult = {
      ...makeResult(simulation.scenario),
      outcome: 'not_entered',
      steps: [],
      traversedEdgeIds: [],
      elapsedSeconds: 0,
      admission: {
        entryBehavior: {
          actual: 'product_viewed',
          expected: 'app_session_started',
          matched: false,
        },
        segment: {
          id: 'segment',
          name: '成年用户',
          matched: false,
          rules: {
            kind: 'compare',
            left: { source: 'user', path: 'age' },
            operator: 'gte',
            right: 18,
          },
        },
      },
    };
    renderPanel({ ...simulation, result, visibleStepCount: result.steps.length });
    expect(screen.getByText('未进入旅程')).toBeTruthy();
    expect(screen.getByText('进入行为不匹配，没有进入旅程。')).toBeTruthy();
    expect(screen.getByText('未满足入口分群“成年用户”。')).toBeTruthy();
    expect(screen.queryByRole('list', { name: '模拟经过的步骤' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /入口分群：不满足/ }));
    expect(screen.getByText('年龄 大于等于 18')).toBeTruthy();
    expect(screen.getByText('浏览商品 · 不匹配')).toBeTruthy();
    expect(screen.getByText('进入应用')).toBeTruthy();
  });

  it('事件次数的时间范围包含进入之前的部分', () => {
    const simulation = makeController();
    const result = makeResult(simulation.scenario);
    result.steps.splice(1, 0, {
      order: 2,
      nodeId: 'condition',
      nodeName: '近七天购买',
      nodeType: 'condition',
      elapsedSeconds: 0,
      rule: {
        kind: 'event_count',
        eventType: 'purchase_completed',
        windowSeconds: 7 * 24 * 60 * 60,
        sameProduct: false,
        operator: 'gte',
        right: 1,
      },
      matched: false,
      branch: 'unmet',
      evidence: {
        kind: 'event_count',
        evaluatedAtSeconds: 0,
        windowStartSeconds: -7 * 24 * 60 * 60,
        windowEndSeconds: 0,
        count: 0,
        checks: [{ eventId: simulation.scenario.entryEvent.id, reason: 'wrong_type' }],
      },
    });
    renderPanel({ ...simulation, result, visibleStepCount: result.steps.length });

    fireEvent.click(screen.getByRole('button', { name: /查看判断详情/ }));
    expect(screen.getByText('进入前 7 天 至 进入时（两端包含）')).toBeTruthy();
    expect(screen.queryByText(/进入后 0 秒 至 进入后 0 秒/)).toBeNull();
  });

  it('进入行为的枚举属性按行为目录显示中文文案', () => {
    const simulation = makeController();
    const result = makeResult(simulation.scenario);
    result.steps.splice(1, 0, {
      order: 2,
      nodeId: 'condition',
      nodeName: '类目判断',
      nodeType: 'condition',
      elapsedSeconds: 0,
      rule: {
        kind: 'compare',
        left: { source: 'entry_event', eventType: 'product_viewed', path: 'category' },
        operator: 'eq',
        right: 'beauty',
      },
      matched: true,
      branch: 'met',
      evidence: { kind: 'value', actual: { exists: true, value: 'beauty' } },
    });
    renderPanel({ ...simulation, result, visibleStepCount: result.steps.length });

    expect(screen.getByText('商品类目：美妆个护 → 走「满足」路径')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /查看判断详情/ }));
    expect(screen.getByText('进入行为的商品类目 等于 美妆个护')).toBeTruthy();
    expect(screen.getByText('美妆个护')).toBeTruthy();
  });

  it('消息正文按需展开，保留完整多行内容', () => {
    const simulation = makeController();
    const result = makeResult(simulation.scenario);
    const body = '欢迎回来\n这是完整的消息正文';
    result.steps.splice(1, 0, {
      order: 2,
      nodeId: 'message',
      nodeName: '欢迎邮件',
      nodeType: 'message',
      elapsedSeconds: 0,
      channel: 'email',
      subject: '欢迎回来',
      body,
    });
    renderPanel({ ...simulation, result, visibleStepCount: result.steps.length });
    expect(screen.queryByText(body, { exact: true })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /查看消息预览/ }));
    expect(screen.getByText('正文（仅预览）')).toBeTruthy();
    expect(screen.getByText(body, { normalizer: (text) => text })).toBeTruthy();
  });

  it('资料无效时拦住模拟并提供直接修改入口', () => {
    const start = vi.fn(async () => undefined);
    renderPanel(makeController({ scenarioErrors: ['年龄必须是数字'], start }));

    expect((screen.getByRole('button', { name: '开始模拟' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '查看资料' }));
    expect(screen.getByRole('dialog', { name: '编辑模拟资料' })).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
  });
});
