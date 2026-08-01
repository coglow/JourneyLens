import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthProvider } from '@/features/auth/auth-provider';
import { QueryProvider } from '@/app/QueryProvider';
import { apiClient } from '@/services/api';
import { appRoutes } from '@/app/router';

const mock = new MockAdapter(apiClient);
const eventId = '3f1c9f1e-2b7a-4d5c-8e9f-0a1b2c3d4e5f';
const account = {
  id: 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120',
  email: 'operator@example.com',
  displayName: 'JourneyLens 管理员',
};
const event = {
  id: eventId,
  type: 'purchase_completed',
  receivedAt: '2026-07-30T08:00:00.000Z',
  payload: { orderId: 'order-1', productId: 'product-1', amount: 0 },
  audience: { externalId: 'user-1', displayName: '林小北' },
};
const campaign = { id: '33333333-3333-4333-8333-333333333333', name: '购买挽回活动' };
const journey = { id: '44444444-4444-4444-8444-444444444444', name: '浏览后购买' };
const version = { id: '55555555-5555-4555-8555-555555555555', versionNumber: 2 };
const enteredExecution = {
  id: '22222222-2222-4222-8222-222222222222',
  campaign,
  journey,
  version,
  status: 'running',
  startedAt: '2026-07-30T08:00:00.000Z',
  enteredByEvent: true,
  matchedStep: null,
};
const matchedExecution = {
  id: '66666666-6666-4666-8666-666666666666',
  campaign,
  journey,
  version,
  status: 'completed',
  startedAt: '2026-07-30T07:50:00.000Z',
  enteredByEvent: false,
  matchedStep: {
    nodeId: 'wait-purchase',
    nodeName: '等待同商品购买',
    endedWaitingAt: '2026-07-30T08:00:12.000Z',
  },
};
const repeatedJourneyExecution = {
  ...matchedExecution,
  id: '77777777-7777-4777-8777-777777777777',
  startedAt: '2026-07-30T07:40:00.000Z',
};

function renderApp(path: string, state?: unknown) {
  const entry =
    state === undefined
      ? path
      : {
          pathname: path.slice(0, path.indexOf('?')),
          search: path.slice(path.indexOf('?')),
          state,
        };
  const router = createMemoryRouter(appRoutes, { initialEntries: [entry] });
  render(
    <ConfigProvider locale={zhCN}>
      <AuthProvider>
        <QueryProvider>
          <RouterProvider router={router} />
        </QueryProvider>
      </AuthProvider>
    </ConfigProvider>,
  );
  return router;
}

beforeEach(() => {
  mock.reset();
  mock.onGet('/userinfo').reply(200, { data: account });
});

afterEach(() => {
  cleanup();
  mock.reset();
});

describe('行为记录详情', () => {
  it('显示行为内容，并恢复统一分页网址和原列表地址', async () => {
    mock.onGet(`/events/${eventId}`).reply(200, { data: event });
    mock.onGet(`/events/${eventId}/executions`).reply(200, {
      data: [matchedExecution],
      page: { page: 2, pageSize: 20, total: 21 },
    });
    const router = renderApp(`/events/${eventId}?page=2&pageSize=20`, {
      returnTo: '?q=林小北&page=3&pageSize=20',
    });

    expect(await screen.findByRole('heading', { name: '完成购买' })).toBeTruthy();
    expect(await screen.findByText('等待步骤：等待同商品购买')).toBeTruthy();
    expect(screen.getByText(/行为ID：/)).toBeTruthy();
    expect(screen.getByText('用户ID')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getAllByText('相关旅程').length).toBeGreaterThanOrEqual(1);
    expect(
      mock.history.get.find((request) => request.url?.endsWith('/executions'))?.params,
    ).toEqual({ page: 2, pageSize: 20 });

    fireEvent.click(screen.getByRole('button', { name: '返回行为记录' }));
    expect(await screen.findByRole('heading', { name: '行为记录' })).toBeTruthy();
    expect(router.state.location.search).toBe('?q=林小北&page=3&pageSize=20');
  });

  it('在同一张表保留进入与结束等待的事实和同旅程的多次参与', async () => {
    mock.onGet(`/events/${eventId}`).reply(200, { data: event });
    mock.onGet(`/events/${eventId}/executions`).reply(200, {
      data: [enteredExecution, matchedExecution, repeatedJourneyExecution],
      page: { page: 1, pageSize: 10, total: 3 },
    });
    const router = renderApp(`/events/${eventId}`);

    expect(await screen.findByText('用户进入旅程')).toBeTruthy();
    expect(screen.getAllByText('等到该行为，流程进入下一步')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: '浏览后购买' })).toHaveLength(3);
    expect(screen.getByText('运行中')).toBeTruthy();
    expect(screen.getAllByText('已完成')).toHaveLength(2);
    expect(screen.getAllByText(/第 2 版 · 进入时间/)).toHaveLength(3);
    expect(screen.getAllByRole('link', { name: '查看过程' })).toHaveLength(3);
    expect(
      mock.history.get.find((request) => request.url?.endsWith('/executions'))?.params,
    ).toEqual({});

    fireEvent.click(screen.getAllByRole('link', { name: '查看过程' })[0]!);
    expect(router.state.location.pathname).toBe(`/executions/${enteredExecution.id}`);
  });

  it('相关旅程为空时只说明没有对应记录', async () => {
    mock.onGet(`/events/${eventId}`).reply(200, { data: event });
    mock.onGet(`/events/${eventId}/executions`).reply(200, {
      data: [],
      page: { page: 1, pageSize: 10, total: 0 },
    });
    renderApp(`/events/${eventId}`);

    expect(await screen.findByText('没有记录用户进入旅程或结束等待的相关情况')).toBeTruthy();
  });

  it('相关旅程读取失败时显示重试提示', async () => {
    mock.onGet(`/events/${eventId}`).reply(200, { data: event });
    mock.onGet(`/events/${eventId}/executions`).reply(503, {});
    renderApp(`/events/${eventId}`);

    expect((await screen.findByRole('alert')).textContent).toContain('服务暂时不可用，请稍后重试');
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeTruthy();
  });

  it('相关旅程请求登录失效时返回登录页面', async () => {
    mock.onGet(`/events/${eventId}`).reply(200, { data: event });
    mock.onGet(`/events/${eventId}/executions`).reply(401, {});
    const router = renderApp(`/events/${eventId}`);

    expect(await screen.findByRole('heading', { name: '登录 JourneyLens' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
  });
});
