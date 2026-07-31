import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

function renderApp(initialPath = `/executions/${executionId}`, state?: unknown) {
  const entry = state === undefined ? initialPath : { pathname: initialPath, state };
  const router = createMemoryRouter(appRoutes, { initialEntries: [entry] });

  function CaptureQueryClient() {
    queryClient = useQueryClient();
    return <RouterProvider router={router} />;
  }

  render(
    <ConfigProvider locale={zhCN}>
      <AuthProvider>
        <QueryProvider>
          <CaptureQueryClient />
        </QueryProvider>
      </AuthProvider>
    </ConfigProvider>,
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
  it('展示固定版本、触发行为、当步证据、等待窗口和演示消息', async () => {
    mock.onGet(`/executions/${executionId}/trace`).reply(200, { data: completedTrace });
    const router = renderApp();

    expect(await screen.findByRole('heading', { name: /霖铃铃的执行轨迹/ })).toBeTruthy();
    expect(screen.getByText('演示环境')).toBeTruthy();
    expect((await screen.findAllByText('已完成')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab', { name: '进入时用户资料' })).toBeNull();
    expect(screen.queryByText('lin@example.com')).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByText('演示活动')).toBeTruthy();
    expect(screen.getByText('浏览后购买挽回')).toBeTruthy();
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
    expect(screen.getByText('演示发送 · 不会实际投递')).toBeTruthy();
    expect(screen.getAllByText(/用户在等待窗口内完成了同商品购买/).length).toBeGreaterThan(0);
    expect(screen.queryByText('每 3 秒自动刷新')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '执行信息' }));
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

  it('执行不存在时明确提示，不展示虚构轨迹', async () => {
    mock.onGet(`/executions/${executionId}/trace`).reply(404, {
      error: { code: 'NOT_FOUND', message: '执行记录不存在', requestId: 'test-request-id' },
    });
    renderApp();

    expect(await screen.findByText('执行记录不存在')).toBeTruthy();
    expect(screen.queryByText('步骤轨迹')).toBeNull();
  });
});
