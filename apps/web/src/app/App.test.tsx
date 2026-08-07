import { ThemeProvider } from '@/app/ThemeProvider';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthProvider } from '@/features/auth/auth-provider';
import { apiClient } from '@/services/api';
import { appRoutes } from './router';
import { QueryProvider } from './QueryProvider';

let mock: MockAdapter;
let queryClient: QueryClient | undefined;

const account = {
  id: 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120',
  email: 'operator@example.com',
  displayName: 'JourneyLens 管理员',
};

function overviewBody() {
  return {
    data: {
      windowStartedAt: '2026-07-30T06:30:12.345Z',
      windowEndedAt: '2026-08-06T06:30:12.345Z',
      campaignStatusCounts: { draft: 0, running: 0, paused: 0, stopped: 0 },
      entryCount: 0,
      goalReachedCount: 0,
      failedCount: 0,
      recentJourneys: [],
      recentCampaigns: [],
    },
  };
}

function unauthorizedBody() {
  return { error: { code: 'AUTH_REQUIRED', message: '需要登录', requestId: 'test-request-id' } };
}

function submitCredentials(): void {
  fireEvent.change(screen.getByLabelText('邮箱'), {
    target: { value: 'operator@example.com' },
  });
  fireEvent.change(screen.getByLabelText('密码'), {
    target: { value: 'correct-password' },
  });
  const form = screen.getByRole('button', { name: /登\s*录/ }).closest('form');
  if (!form) throw new Error('未找到登录表单');
  fireEvent.submit(form);
}

function renderApp(initialPath = '/') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [initialPath] });

  function CaptureQueryClient() {
    queryClient = useQueryClient();
    return <RouterProvider router={router} />;
  }

  render(
    <ThemeProvider>
      <AuthProvider>
        <QueryProvider>
          <CaptureQueryClient />
        </QueryProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
  return router;
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
});

afterEach(() => {
  cleanup();
  localStorage.removeItem('journeylens-color-mode');
  delete document.documentElement.dataset.colorMode;
  document.documentElement.style.removeProperty('background-color');
  queryClient?.clear();
  queryClient = undefined;
  mock.restore();
  vi.restoreAllMocks();
});

describe('登录与会话路由', () => {
  it('登录页切换主题同步插图并保留账号输入，登录与退出继续沿用深色', async () => {
    mock.onGet('/userinfo').replyOnce(401, unauthorizedBody());
    mock.onPost('/auth/login').replyOnce(200, { data: account });
    mock.onGet('/overview').replyOnce(200, overviewBody());
    mock.onPost('/auth/logout').replyOnce(204);
    renderApp('/login');
    const email = await screen.findByLabelText('邮箱');
    const password = screen.getByLabelText('密码');
    const preview = screen.getByRole('img', { name: /旅程编排界面示意图/ }) as HTMLImageElement;
    expect(preview.style.colorScheme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: '填入演示账号' }));
    fireEvent.click(screen.getByRole('button', { name: '切换为深色模式' }));
    expect((email as HTMLInputElement).value).toBe('demo@example.com');
    expect((password as HTMLInputElement).value).toBe('demo123456');
    expect(preview.style.colorScheme).toBe('dark');
    expect(document.documentElement.dataset.colorMode).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: '切换为浅色模式' }));
    expect(preview.style.colorScheme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: '切换为深色模式' }));
    submitCredentials();
    await screen.findByText('JourneyLens 管理员');
    expect(screen.getByRole('button', { name: '切换为浅色模式' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    await screen.findByRole('heading', { name: '登录工作台' });
    expect(screen.getByRole('button', { name: '切换为浅色模式' })).toBeTruthy();
    expect(
      (screen.getByRole('img', { name: /旅程编排界面示意图/ }) as HTMLImageElement).style
        .colorScheme,
    ).toBe('dark');
    expect(localStorage.getItem('journeylens-color-mode')).toBe('dark');
  });

  it('未登录访问受保护页面跳转到 /login，显示空白登录表单，不预填凭据', async () => {
    mock.onGet('/userinfo').replyOnce(401, unauthorizedBody());
    const router = renderApp('/');

    expect(await screen.findByRole('heading', { name: '登录工作台' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('密码') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: '填入演示账号' })).toBeTruthy();
    expect(mock.history.get[0]?.url).toBe('/userinfo');
    expect(mock.history.get[0]?.baseURL).toBe('/api');
    expect(mock.history.get[0]?.withCredentials).toBeFalsy();
  });

  it('演示账号只在点击后填入，点击登录才提交', async () => {
    mock.onGet('/userinfo').replyOnce(401, unauthorizedBody());
    mock.onPost('/auth/login').replyOnce(200, { data: account });
    mock.onGet('/overview').replyOnce(200, overviewBody());
    renderApp('/login');

    fireEvent.click(await screen.findByRole('button', { name: '填入演示账号' }));
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe('demo@example.com');
    expect((screen.getByLabelText('密码') as HTMLInputElement).value).toBe('demo123456');
    expect(mock.history.post).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
    await screen.findByText('JourneyLens 管理员');
    expect(JSON.parse(String(mock.history.post[0]?.data))).toEqual({
      email: 'demo@example.com',
      password: 'demo123456',
    });
  });

  it('登录后进入工作台，退出成功后回到登录页', async () => {
    mock.onGet('/userinfo').replyOnce(401, unauthorizedBody());
    mock.onPost('/auth/login').replyOnce(200, { data: account });
    mock.onGet('/overview').replyOnce(200, overviewBody());
    mock.onPost('/auth/logout').replyOnce(204);
    const router = renderApp('/');

    await screen.findByRole('heading', { name: '登录工作台' });
    submitCredentials();
    expect(await screen.findByText('JourneyLens 管理员')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/overview');
    expect(screen.getByRole('banner').textContent).toContain('JourneyLens');
    expect(
      screen.getByRole('menuitem', { name: '概览' }).classList.contains('ant-menu-item-selected'),
    ).toBe(true);
    expect(screen.getByRole('menuitem', { name: '活动' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '旅程统计' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '分群' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '执行记录' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '行为记录' })).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
    const navigation = screen.getByRole('navigation', { name: '主导航' });
    expect(
      within(navigation)
        .getAllByRole('group')
        .map((group) =>
          within(group)
            .getAllByRole('menuitem')
            .map((item) => item.textContent),
        ),
    ).toEqual([
      ['概览', '活动', '分群'],
      ['旅程统计', '执行记录', '行为记录'],
    ]);
    expect(await screen.findByText('近 7 天还没有进入旅程的记录')).toBeTruthy();
    expect(mock.history.get.map((request) => request.url)).toContain('/overview');
    expect(mock.history.post[0]?.url).toBe('/auth/login');
    expect(mock.history.post[0]?.baseURL).toBe('/api');
    expect(JSON.parse(String(mock.history.post[0]?.data))).toEqual({
      email: 'operator@example.com',
      password: 'correct-password',
    });

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    expect(await screen.findByRole('heading', { name: '登录工作台' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(mock.history.post[1]?.url).toBe('/auth/logout');
  });

  it('已登录访问 /login 会回到工作台', async () => {
    mock.onGet('/userinfo').replyOnce(200, { data: account });
    mock.onGet('/overview').replyOnce(200, overviewBody());
    const router = renderApp('/login');

    expect(await screen.findByText('JourneyLens 管理员')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/overview');
  });

  it('侧栏折叠后隐藏分组标题，跨组切换菜单后展开仍保留选中项与当前位置', async () => {
    mock.onGet('/userinfo').replyOnce(200, { data: account });
    mock.onGet('/segments').replyOnce(200, {
      data: [],
      page: { page: 1, pageSize: 10, total: 0 },
    });
    mock.onGet('/journey-stats').replyOnce(200, {
      data: [],
      page: { page: 1, pageSize: 10, total: 0 },
    });
    renderApp('/segments');

    const breadcrumb = await screen.findByRole('navigation', { name: '当前位置' });
    expect(breadcrumb.textContent).toContain('运营工作台');
    expect(breadcrumb.textContent).toContain('分群');
    const navigation = screen.getByRole('navigation', { name: '主导航' });
    expect(within(navigation).getByText('运营')).toBeTruthy();
    expect(within(navigation).getByText('观察')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '折叠侧栏' }));
    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeTruthy();
    expect(within(navigation).queryByText('运营')).toBeNull();
    expect(within(navigation).queryByText('观察')).toBeNull();
    expect(within(navigation).getAllByRole('menuitem')).toHaveLength(6);

    fireEvent.click(within(navigation).getByRole('menuitem', { name: '旅程统计' }));
    expect(await screen.findByRole('main', { name: '旅程统计工作区' })).toBeTruthy();
    expect(breadcrumb.textContent).toContain('旅程统计');
    fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }));
    expect(screen.getByRole('button', { name: '折叠侧栏' })).toBeTruthy();
    expect(within(navigation).getByText('运营')).toBeTruthy();
    expect(within(navigation).getByText('观察')).toBeTruthy();
    expect(
      within(navigation)
        .getByRole('menuitem', { name: '旅程统计' })
        .classList.contains('ant-menu-item-selected'),
    ).toBe(true);
  });

  it('小窗口首次进入自动折叠，跨过 1200px 后自动展开或折叠，并支持手动切换', async () => {
    const breakpoint = 'screen and (max-width: 1199.98px)';
    const originalMatchMedia = window.matchMedia;
    const mediaEvents = new EventTarget();
    const sidebarMedia = {
      ...originalMatchMedia(breakpoint),
      matches: true,
      addEventListener: mediaEvents.addEventListener.bind(mediaEvents),
      removeEventListener: mediaEvents.removeEventListener.bind(mediaEvents),
    };
    vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
      query === breakpoint ? sidebarMedia : originalMatchMedia(query),
    );
    function resizeViewport(matches: boolean): void {
      act(() => {
        sidebarMedia.matches = matches;
        mediaEvents.dispatchEvent(Object.assign(new Event('change'), { matches }));
      });
    }

    mock.onGet('/userinfo').replyOnce(200, { data: account });
    mock.onGet('/segments').replyOnce(200, {
      data: [],
      page: { page: 1, pageSize: 10, total: 0 },
    });
    renderApp('/segments');

    expect(await screen.findByRole('button', { name: '展开侧栏' })).toBeTruthy();
    const navigation = screen.getByRole('navigation', { name: '主导航' });
    expect(within(navigation).queryByText('运营')).toBeNull();

    resizeViewport(false);
    expect(screen.getByRole('button', { name: '折叠侧栏' })).toBeTruthy();
    expect(within(navigation).getByText('运营')).toBeTruthy();

    resizeViewport(true);
    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeTruthy();
    expect(within(navigation).queryByText('观察')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }));
    expect(within(navigation).getByText('观察')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '折叠侧栏' }));
    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeTruthy();
  });

  it('菜单可进入旅程统计，标题、面包屑与工作区名称一致', async () => {
    mock.onGet('/userinfo').replyOnce(200, { data: account });
    mock.onGet('/journey-stats').replyOnce(200, {
      data: [],
      page: { page: 1, pageSize: 10, total: 0 },
    });
    renderApp('/journey-stats');

    expect(await screen.findByRole('heading', { name: '旅程统计' })).toBeTruthy();
    const breadcrumb = screen.getByRole('navigation', { name: '当前位置' });
    expect(breadcrumb.textContent).toContain('旅程统计');
    expect(screen.getByRole('main', { name: '旅程统计工作区' })).toBeTruthy();
    expect(await screen.findByText('暂无已发布版本的旅程')).toBeTruthy();
    expect(mock.history.get.map((request) => request.url)).toContain('/journey-stats');
  });

  it('新增概览菜单后旅程详情仍归属活动', async () => {
    mock.onGet('/userinfo').replyOnce(200, { data: account });
    mock.onGet('/journeys/8a2d4b6c-1e3f-4a5b-9c7d-2e4f6a8b0c1d').replyOnce(404, {
      error: { code: 'NOT_FOUND', message: '旅程不存在', requestId: 'test-request-id' },
    });
    renderApp('/journeys/8a2d4b6c-1e3f-4a5b-9c7d-2e4f6a8b0c1d');
    expect(await screen.findByRole('main', { name: '活动工作区' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: '当前位置' }).textContent).toContain('活动');
    expect(
      screen.getByRole('menuitem', { name: '活动' }).classList.contains('ant-menu-item-selected'),
    ).toBe(true);
  });

  it('错误密码展示服务端的实际错误', async () => {
    mock.onGet('/userinfo').replyOnce(401, unauthorizedBody());
    mock.onPost('/auth/login').replyOnce(401, {
      error: {
        code: 'INVALID_CREDENTIALS',
        message: '邮箱或密码不正确',
        requestId: 'test-request-id',
      },
    });
    renderApp('/');

    await screen.findByRole('heading', { name: '登录工作台' });
    submitCredentials();
    expect((await screen.findByRole('alert')).textContent).toContain('邮箱或密码不正确');
    expect(screen.getByRole('heading', { name: '登录工作台' })).toBeTruthy();
  });

  it('服务不可达时显示重试，不当作未登录；重试收到 401 后才进入登录页', async () => {
    mock.onGet('/userinfo').networkErrorOnce();
    mock.onGet('/userinfo').replyOnce(401, unauthorizedBody());
    const router = renderApp('/');

    expect(await screen.findByText('暂时无法连接服务')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '登录工作台' })).toBeNull();
    expect(router.state.location.pathname).toBe('/overview');
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByRole('heading', { name: '登录工作台' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('退出请求失败时显示错误并保留已登录账号', async () => {
    mock.onGet('/userinfo').replyOnce(200, { data: account });
    mock.onGet('/overview').replyOnce(200, overviewBody());
    mock.onPost('/auth/logout').networkErrorOnce();
    const router = renderApp('/');

    expect(await screen.findByText('JourneyLens 管理员')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    expect((await screen.findByRole('alert')).textContent).toContain('无法连接服务器');
    expect(screen.getByText('JourneyLens 管理员')).toBeTruthy();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/overview');
  });
});
