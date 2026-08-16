import { ThemeProvider } from '@/app/ThemeProvider';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthProvider } from '@/features/auth/auth-provider';
import { QueryProvider } from '@/app/QueryProvider';
import { apiClient } from '@/services/api';
import { appRoutes } from '@/app/router';
import { executionQueryKeys } from './execution-queries';

let mock: MockAdapter;
let queryClient: QueryClient | undefined;

const account = {
  id: 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120',
  email: 'operator@example.com',
  displayName: 'JourneyLens 管理员',
};
const executionId = '3f1c9f1e-2b7a-4d5c-8e9f-0a1b2c3d4e5f';
const campaignId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb60';
const journeyId = '8a2d4b6c-1e3f-4a5b-9c7d-2e4f6a8b0c1d';
const versionId = '22222222-2222-4222-8222-222222222222';
const audienceId = '33333333-3333-4333-8333-333333333333';
const eventId = '44444444-4444-4444-8444-444444444444';
const matchedEventId = '55555555-5555-4555-8555-555555555555';
const goalEventId = '66666666-6666-4666-8666-666666666666';

const baseStep = {
  order: 1,
  nodeId: 'start',
  nodeName: '用户浏览商品',
  nodeType: 'start',
  status: 'succeeded',
  startedAt: '2026-07-30T08:00:00.000Z',
  endedAt: '2026-07-30T08:00:00.000Z',
  deadlineAt: null,
  matchedEventId: null,
  failureReason: null,
};

const completedTrace = {
  id: executionId,
  status: 'completed',
  currentNode: { nodeId: 'end-matched', name: '购买分支结束', nodeType: 'end' },
  failureReason: null,
  createdAt: '2026-07-30T08:00:00.000Z',
  startedAt: '2026-07-30T08:00:00.000Z',
  endedAt: '2026-07-30T08:00:12.000Z',
  campaign: { id: campaignId, name: '演示活动', status: 'running' },
  journey: { id: journeyId, name: '浏览后购买挽回' },
  version: { id: versionId, versionNumber: 1, publishedAt: '2026-07-30T07:00:00.000Z' },
  audience: {
    externalId: 'upstream:demo:eligible',
    displayName: '霖铃铃',
  },
  goal: null,
  entryEvidence: {
    segment: {
      name: '黄金会员',
      rules: {
        kind: 'compare',
        left: { source: 'user', path: 'vipLevel' },
        operator: 'in',
        right: ['gold'],
      },
    },
    values: [{ field: 'vipLevel', actual: { exists: true, value: 'gold' } }],
  },
  triggerEvent: {
    id: eventId,
    type: 'product_viewed',
    receivedAt: '2026-07-30T08:00:00.000Z',
    payload: { productId: 'product-1', productName: '演示无线耳机', price: 299 },
  },
  steps: [
    { ...baseStep, output: { kind: 'start', entryBehavior: 'product_viewed' } },
    {
      ...baseStep,
      order: 2,
      nodeId: 'condition-price',
      nodeName: '商品价格判断',
      nodeType: 'condition',
      output: {
        kind: 'condition',
        rule: {
          kind: 'compare',
          left: { source: 'entry_event', eventType: 'product_viewed', path: 'price' },
          operator: 'gte',
          right: 100,
        },
        matched: true,
        branch: 'met',
        evidence: {
          kind: 'value',
          evaluatedAt: '2026-07-30T08:00:00.000Z',
          actual: { exists: true, value: 299 },
        },
      },
    },
    {
      ...baseStep,
      order: 3,
      nodeId: 'wait',
      nodeName: '等待 5 秒',
      nodeType: 'wait',
      startedAt: '2026-07-30T08:00:00.000Z',
      endedAt: '2026-07-30T08:00:05.000Z',
      deadlineAt: '2026-07-30T08:00:05.000Z',
      output: { kind: 'wait', waitSeconds: 5 },
    },
    {
      ...baseStep,
      order: 4,
      nodeId: 'wait-purchase',
      nodeName: '等待同商品购买',
      nodeType: 'wait_for_event',
      startedAt: '2026-07-30T08:00:05.000Z',
      endedAt: '2026-07-30T08:00:10.000Z',
      deadlineAt: '2026-07-30T08:01:05.000Z',
      matchedEventId,
      output: {
        kind: 'wait_for_event',
        eventType: 'purchase_completed',
        waitSeconds: 60,
        sameProduct: true,
        outcome: 'matched',
        matchedEventId,
      },
    },
    {
      ...baseStep,
      order: 5,
      nodeId: 'message-thanks',
      nodeName: '购买感谢消息',
      nodeType: 'message',
      startedAt: '2026-07-30T08:00:10.000Z',
      endedAt: '2026-07-30T08:00:10.000Z',
      output: {
        kind: 'message',
        channel: 'sms',
        subject: null,
        body: '感谢购买，我们会尽快为你安排发货。',
        audienceUserId: audienceId,
        demo: true,
      },
    },
    {
      ...baseStep,
      order: 6,
      nodeId: 'end-matched',
      nodeName: '购买分支结束',
      nodeType: 'end',
      startedAt: '2026-07-30T08:00:12.000Z',
      endedAt: '2026-07-30T08:00:12.000Z',
      output: { kind: 'end', note: '用户在等待窗口内完成了同商品购买' },
    },
  ],
};

const waitingTrace = {
  ...completedTrace,
  status: 'waiting',
  currentNode: { nodeId: 'wait-purchase', name: '等待同商品购买', nodeType: 'wait_for_event' },
  endedAt: null,
  steps: [
    ...completedTrace.steps.slice(0, 3),
    {
      ...completedTrace.steps[3]!,
      status: 'waiting',
      endedAt: null,
      matchedEventId: null,
      output: {
        kind: 'wait_for_event',
        eventType: 'purchase_completed',
        waitSeconds: 60,
        sameProduct: true,
        outcome: null,
        matchedEventId: null,
      },
    },
  ],
};

const goalTrace = {
  ...completedTrace,
  goal: {
    eventType: 'purchase_completed',
    sameProduct: true,
    reachedAt: '2026-07-30T08:00:09.000Z',
    event: {
      id: goalEventId,
      type: 'purchase_completed',
      receivedAt: '2026-07-30T08:00:09.000Z',
      payload: { productId: 'product-1', productName: '演示无线耳机', amount: 299 },
    },
  },
  steps: [
    ...completedTrace.steps.slice(0, 3),
    {
      ...completedTrace.steps[3]!,
      status: 'stopped',
      endedAt: '2026-07-30T08:00:12.000Z',
      matchedEventId: null,
      output: {
        kind: 'wait_for_event',
        eventType: 'purchase_completed',
        waitSeconds: 60,
        sameProduct: true,
        outcome: null,
        matchedEventId: null,
      },
    },
  ],
};

function renderApp(initialPath = `/executions/${executionId}`, state?: unknown) {
  const entry = state === undefined ? initialPath : { pathname: initialPath, state };
  const router = createMemoryRouter(appRoutes, { initialEntries: [entry] });

  function CaptureQueryClient() {
    queryClient = useQueryClient();
    return <RouterProvider router={router} />;
  }

  render(
    <ThemeProvider>
      <ConfigProvider locale={zhCN}>
        <AuthProvider>
          <QueryProvider>
            <CaptureQueryClient />
          </QueryProvider>
        </AuthProvider>
      </ConfigProvider>
    </ThemeProvider>,
  );
  return router;
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  mock.onGet('/userinfo').reply(200, { data: account });
});

afterEach(() => {
  cleanup();
  queryClient?.clear();
  queryClient = undefined;
  mock.restore();
});

describe('执行轨迹详情', () => {
  it.each([
    { name: '同一秒完成', endedAt: '2026-07-30T08:00:00.800Z', showRange: false },
    { name: '尚未结束', endedAt: null, showRange: false },
    { name: '同一天的不同时刻', endedAt: '2026-07-30T08:00:05.000Z', showRange: true },
    { name: '跨天的相同时刻', endedAt: '2026-07-31T08:00:00.000Z', showRange: true },
  ])('步骤标题显示完整日期时间：$name', async ({ endedAt, showRange }) => {
    mock.onGet(`/executions/${executionId}/trace`).reply(200, {
      data: {
        ...completedTrace,
        status: endedAt === null ? 'running' : 'completed',
        endedAt,
        steps: [{ ...completedTrace.steps[0], endedAt }],
      },
    });
    renderApp();

    const stepHeader = await screen.findByRole('button', { name: /1\. 用户浏览商品/ });
    const start = new Date(baseStep.startedAt).toLocaleString('zh-CN');
    const end = endedAt === null ? null : new Date(endedAt).toLocaleString('zh-CN');
    const time = within(stepHeader).getByText(start).parentElement;
    expect(time?.textContent).toBe(showRange ? `${start} — ${end}` : start);
  });

  it('触发行为展示明确空值和零，继续省略未提供的属性', async () => {
    mock.onGet(`/executions/${executionId}/trace`).reply(200, {
      data: {
        ...completedTrace,
        triggerEvent: {
          ...completedTrace.triggerEvent,
          payload: { productId: 'product-1', productName: null, price: 0 },
        },
      },
    });
    renderApp();
    fireEvent.click(await screen.findByRole('tab', { name: '触发行为' }));

    expect(await screen.findByText('未填写')).toBeTruthy();
    expect(screen.getByText('商品名称')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByText('商品类目')).toBeNull();
    expect(screen.queryByText('null')).toBeNull();
  });

  it('目标行为也展示明确空值并省略未提供的属性', async () => {
    mock.onGet(`/executions/${executionId}/trace`).reply(200, {
      data: {
        ...goalTrace,
        goal: {
          ...goalTrace.goal,
          event: { ...goalTrace.goal.event, payload: { productName: null, amount: 0 } },
        },
      },
    });
    renderApp();

    expect(await screen.findByText('未填写')).toBeTruthy();
    expect(screen.getByText('商品名称')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByText('商品 ID')).toBeNull();
    expect(screen.queryByText('null')).toBeNull();
  });

  it.each([
    { actual: { exists: false }, expected: '未提供' },
    { actual: { exists: true, value: null }, expected: '未填写' },
    { actual: { exists: true, value: [] }, expected: '空列表' },
  ])('条件证据保留不同的空值含义：$expected', async ({ actual, expected }) => {
    mock.onGet(`/executions/${executionId}/trace`).reply(200, {
      data: {
        ...completedTrace,
        steps: [
          {
            ...baseStep,
            nodeId: 'condition',
            nodeName: '兴趣判断',
            nodeType: 'condition',
            output: {
              kind: 'condition',
              rule: {
                kind: 'compare',
                left: { source: 'user', path: 'interests' },
                operator: 'contains',
                right: '咖啡',
              },
              matched: false,
              branch: 'unmet',
              evidence: { kind: 'value', evaluatedAt: baseStep.startedAt, actual },
            },
          },
        ],
      },
    });
    renderApp();
    expect(await screen.findByText(`实际：${expected}，走“不满足”路径`)).toBeTruthy();
  });

  it('展示固定版本、触发行为、当步证据、等待窗口和演示消息', async () => {
    mock.onGet(`/executions/${executionId}/trace`).reply(200, { data: completedTrace });
    const router = renderApp();

    expect(await screen.findByRole('heading', { name: /霖铃铃的执行轨迹/ })).toBeTruthy();
    expect((await screen.findAllByText('已完成')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab', { name: '进入时用户资料' })).toBeNull();
    expect(screen.queryByText('lin@example.com')).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByText('演示活动')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '旅程名称：浏览后购买挽回' })).toBeTruthy();
    expect(screen.getByText('所属活动')).toBeTruthy();
    expect(screen.getByText('旅程版本')).toBeTruthy();
    expect(screen.getByText('开始时间')).toBeTruthy();
    expect(screen.getByText('结束时间')).toBeTruthy();
    expect(screen.getByText('步骤数量')).toBeTruthy();
    expect(screen.getByText('总历时')).toBeTruthy();
    expect(screen.getByText('12 秒')).toBeTruthy();
    expect(screen.getByText('结束结果')).toBeTruthy();
    expect(screen.queryByText('感谢购买，我们会尽快为你安排发货。')).toBeNull();
    expect(screen.getByText(/商品价格判断/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /1\. 用户浏览商品/ }));
    expect(await screen.findByText('入口人群：黄金会员')).toBeTruthy();
    expect(screen.getAllByText('黄金').length).toBeGreaterThan(0);
    expect(screen.queryByText('年龄')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /2\. 商品价格判断/ }));
    expect(screen.getByText(/结果：满足/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /4\. 等待同商品购买/ }));
    expect(screen.getByText(/等到匹配行为/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /5\. 购买感谢消息/ }));
    expect(screen.getByText('感谢购买，我们会尽快为你安排发货。')).toBeTruthy();
    expect(screen.getByText('短信')).toBeTruthy();
    expect(screen.getAllByText(/用户在等待窗口内完成了同商品购买/).length).toBeGreaterThan(0);
    expect(screen.queryByText('每 3 秒自动刷新')).toBeNull();

    fireEvent.mouseEnter(screen.getByRole('button', { name: '执行信息' }));
    expect(await screen.findByText('upstream:demo:eligible')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '触发行为' }));
    expect(await screen.findByText('演示无线耳机')).toBeTruthy();
    expect(screen.getByText('299')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '查看该发布版本' }));
    expect(router.state.location.pathname).toBe(`/journeys/${journeyId}/versions/${versionId}`);
  });

  it('等待中展示截止时间和自动刷新提示，返回时恢复原筛选', async () => {
    mock.onGet(`/executions/${executionId}/trace`).reply(200, { data: waitingTrace });
    const router = renderApp(`/executions/${executionId}`, {
      returnTo: '?q=lin&page=2&pageSize=20',
    });

    expect(await screen.findByText('每 3 秒自动刷新')).toBeTruthy();
    expect(screen.getByText('当前进展')).toBeTruthy();
    expect(screen.getByText('尚未结束')).toBeTruthy();
    expect(screen.queryByText('12 秒')).toBeNull();
    expect(screen.getAllByText('等待中').length).toBeGreaterThan(0);
    expect(screen.getByText(/等待截止/)).toBeTruthy();
    expect(screen.getByText(/正在等待匹配行为或到期/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '返回执行记录' }));
    expect(router.state.location.pathname).toBe('/executions');
    expect(router.state.location.search).toBe('?q=lin&page=2&pageSize=20');
  });

  it('刷新后保留手动展开的步骤和选中页签', async () => {
    mock.onGet(`/executions/${executionId}/trace`).reply(200, { data: waitingTrace });
    renderApp();
    expect(await screen.findByText('每 3 秒自动刷新')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /2\. 商品价格判断/ }));
    await act(async () => {
      mock.onGet(`/executions/${executionId}/trace`).reply(200, { data: completedTrace });
      await queryClient!.refetchQueries({ queryKey: executionQueryKeys.trace(executionId) });
    });
    expect(
      screen.getByRole('button', { name: /2\. 商品价格判断/ }).getAttribute('aria-expanded'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: '触发行为' }));
    await act(async () => {
      await queryClient!.refetchQueries({ queryKey: executionQueryKeys.trace(executionId) });
    });
    expect(screen.getByRole('tab', { name: '触发行为' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('执行失败时展示失败原因字段，保留零秒历时', async () => {
    const reason = '「欢迎消息」的消息内容替换后超过 2000 字，请精简后重试';
    mock.onGet(`/executions/${executionId}/trace`).reply(200, {
      data: {
        ...completedTrace,
        status: 'failed',
        failureReason: reason,
        currentNode: { nodeId: 'message', name: '欢迎消息', nodeType: 'message' },
        endedAt: completedTrace.startedAt,
        steps: [
          completedTrace.steps[0],
          {
            ...baseStep,
            order: 2,
            nodeId: 'message',
            nodeName: '欢迎消息',
            nodeType: 'message',
            status: 'failed',
            failureReason: reason,
            output: { kind: 'failed', reason },
          },
        ],
      },
    });
    renderApp();

    expect(await screen.findByText('失败原因')).toBeTruthy();
    expect(screen.getAllByText(reason).length).toBeGreaterThan(0);
    expect(screen.getByText('0 秒')).toBeTruthy();
    expect(screen.queryByText('结束结果')).toBeNull();
    expect(screen.queryByText('每 3 秒自动刷新')).toBeNull();
  });

  it('运行中展示当前进展，不将未结束的执行显示为零秒', async () => {
    mock.onGet(`/executions/${executionId}/trace`).reply(200, {
      data: {
        ...completedTrace,
        status: 'running',
        currentNode: { nodeId: 'start', name: '用户浏览商品', nodeType: 'start' },
        endedAt: null,
        steps: [],
      },
    });
    renderApp();

    expect(await screen.findByText('当前进展')).toBeTruthy();
    expect(screen.getByText('正在运行「用户浏览商品」。')).toBeTruthy();
    expect(screen.getByText('尚未结束')).toBeTruthy();
    expect(screen.queryByText('0 秒')).toBeNull();
    expect(screen.getByText('每 3 秒自动刷新')).toBeTruthy();
  });

  it('已停止的等待不再显示正在等待', async () => {
    const stoppedStep = {
      ...waitingTrace.steps.at(-1)!,
      status: 'stopped',
      endedAt: '2026-07-30T08:00:12.000Z',
    };
    mock.onGet(`/executions/${executionId}/trace`).reply(200, {
      data: {
        ...waitingTrace,
        status: 'stopped',
        endedAt: '2026-07-30T08:00:12.000Z',
        steps: [...waitingTrace.steps.slice(0, -1), stoppedStep],
      },
    });
    renderApp();
    expect(await screen.findByText('活动已停止，尚未结束的步骤已终止。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /4\. 等待同商品购买/ }));
    expect(await screen.findByText('活动停止，等待已终止')).toBeTruthy();
    expect(screen.queryByText('正在等待匹配行为或到期')).toBeNull();
  });

  it('达成目标时展示目标证据、结束原因和目标行为接收时间', async () => {
    mock.onGet(`/executions/${executionId}/trace`).reply(200, { data: goalTrace });
    renderApp();

    expect(await screen.findByText('目标已达成，已退出旅程。')).toBeTruthy();
    expect(screen.getByText('活动目标')).toBeTruthy();
    expect(screen.getByText('完成购买（只算同一件商品）')).toBeTruthy();
    expect(screen.getByText('目标行为接收时间')).toBeTruthy();
    expect(screen.getByText('执行结束时间')).toBeTruthy();
    expect(screen.getByText('已达成')).toBeTruthy();
    expect(screen.getAllByText('演示无线耳机').length).toBeGreaterThan(0);

    // 同一个已停止的等待步骤，达成退出的文案不能写成活动停止。
    fireEvent.click(screen.getByRole('button', { name: /4\. 等待同商品购买/ }));
    expect(screen.getAllByText('目标已达成，等待已结束').length).toBeGreaterThan(0);
    expect(screen.queryByText('活动停止，等待已终止')).toBeNull();
    expect(screen.queryByText('正在等待匹配行为或到期')).toBeNull();
  });

  it('已设置目标但尚未达成时展示目标配置，不展示达成证据', async () => {
    mock.onGet(`/executions/${executionId}/trace`).reply(200, {
      data: {
        ...waitingTrace,
        goal: {
          eventType: 'purchase_completed',
          sameProduct: true,
          reachedAt: null,
          event: null,
        },
      },
    });
    renderApp();

    expect(await screen.findByText('尚未达成')).toBeTruthy();
    expect(screen.getByText('完成购买（只算同一件商品）')).toBeTruthy();
    expect(screen.queryByText('目标行为接收时间')).toBeNull();
    expect(screen.queryByText('执行结束时间')).toBeNull();
    expect(screen.queryByText('达成行为')).toBeNull();
    expect(screen.getByText('每 3 秒自动刷新')).toBeTruthy();
  });

  it('首个节点前达成目标时说明未执行节点，并展示未记录位置', async () => {
    mock.onGet(`/executions/${executionId}/trace`).reply(200, {
      data: { ...goalTrace, steps: [], currentNode: null },
    });
    renderApp();

    expect(await screen.findByText('目标已达成，已退出旅程。')).toBeTruthy();
    expect(screen.getByText('本次尚未执行任何步骤，目标达成后已退出旅程。')).toBeTruthy();
    expect(screen.queryByText('后台尚未开始处理这次执行，页面会自动刷新。')).toBeNull();

    fireEvent.focus(screen.getByRole('button', { name: '执行信息' }));
    expect(await screen.findByText('未记录位置')).toBeTruthy();
  });

  it('未设置目标时不展示目标区域', async () => {
    mock.onGet(`/executions/${executionId}/trace`).reply(200, { data: completedTrace });
    renderApp();

    expect(await screen.findByRole('heading', { name: /霖铃铃的执行轨迹/ })).toBeTruthy();
    expect(screen.queryByText('活动目标')).toBeNull();
    expect(screen.queryByText('目标行为接收时间')).toBeNull();
    // 正常结束仍展示原有结束说明。
    expect(screen.getAllByText(/用户在等待窗口内完成了同商品购买/).length).toBeGreaterThan(0);
  });

  it('执行不存在时明确提示，不展示虚构轨迹', async () => {
    mock.onGet(`/executions/${executionId}/trace`).reply(404, {
      error: { code: 'NOT_FOUND', message: '执行记录不存在', requestId: 'test-request-id' },
    });
    renderApp();

    expect(await screen.findByText('执行记录不存在')).toBeTruthy();
    expect(screen.queryByText('步骤轨迹')).toBeNull();
  });
});
