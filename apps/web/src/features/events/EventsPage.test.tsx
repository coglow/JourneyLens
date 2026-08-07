import { ThemeProvider } from '@/app/ThemeProvider';
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
  type: 'product_viewed',
  receivedAt: '2026-07-30T08:00:00.000Z',
  audience: { externalId: 'user-1', displayName: '林小北' },
};

function renderApp(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <ThemeProvider>
      <ConfigProvider locale={zhCN}>
        <AuthProvider>
          <QueryProvider>
            <RouterProvider router={router} />
          </QueryProvider>
        </AuthProvider>
      </ConfigProvider>
    </ThemeProvider>,
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

describe('行为记录列表', () => {
  it('从网址恢复筛选和分页，并从详情返回原列表地址', async () => {
    mock.onGet('/events').reply(200, {
      data: [event],
      page: { page: 2, pageSize: 20, total: 21 },
    });
    mock.onGet(`/events/${eventId}`).reply(200, {
      data: {
        id: eventId,
        type: 'product_viewed',
        receivedAt: event.receivedAt,
        payload: { productId: 'product-1', price: 299 },
        audience: event.audience,
      },
    });
    mock.onGet(`/events/${eventId}/executions`).reply(200, {
      data: [],
      page: { page: 1, pageSize: 10, total: 0 },
    });
    const router = renderApp(`/events?q=林小北&eventId=${eventId}&page=2&pageSize=20`);

    expect(await screen.findByRole('heading', { name: '行为记录' })).toBeTruthy();
    expect(await screen.findByText('林小北')).toBeTruthy();
    expect(screen.getByText('用户ID：user-1')).toBeTruthy();
    expect(screen.getAllByText('行为ID').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('创建的执行')).toBeNull();
    expect(screen.queryByText('继续的执行')).toBeNull();
    expect(mock.history.get.find((request) => request.url === '/events')?.params).toEqual({
      q: '林小北',
      eventId,
      page: 2,
      pageSize: 20,
    });

    fireEvent.click(screen.getByRole('link', { name: '查看详情' }));
    expect(await screen.findByText('商品价格（元）')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回行为记录' }));
    expect(await screen.findByRole('heading', { name: '行为记录' })).toBeTruthy();
    expect(router.state.location.search).toBe(`?q=林小北&eventId=${eventId}&page=2&pageSize=20`);
  });

  it('网址分页无效时提示用户，不把筛选当成空结果', async () => {
    renderApp('/events?pageSize=25');

    expect((await screen.findByRole('alert')).textContent).toContain(
      '每页条数只能选择 10、20 或 50 条',
    );
    expect(mock.history.get.some((request) => request.url === '/events')).toBe(false);
  });

  it('没有符合条件的行为时显示空状态，读取失败时保留重试反馈', async () => {
    mock.onGet('/events').replyOnce(200, {
      data: [],
      page: { page: 1, pageSize: 10, total: 0 },
    });
    renderApp('/events');

    expect(await screen.findByText('还没有已接收的行为')).toBeTruthy();
    cleanup();

    mock.onGet('/events').replyOnce(503, {});
    renderApp('/events');
    expect((await screen.findByRole('alert')).textContent).toContain('服务暂时不可用，请稍后重试');
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeTruthy();
  });

  it('行为查询登录失效时回到登录页面', async () => {
    mock.onGet('/events').reply(401, {});
    const router = renderApp('/events');

    expect(await screen.findByRole('heading', { name: '登录 JourneyLens' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
  });
});
