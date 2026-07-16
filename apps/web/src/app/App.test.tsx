import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthProvider } from '../features/auth/auth-provider';
import { appRoutes } from './router';

const fetchMock = vi.fn<typeof fetch>();
const account = {
  id: 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120',
  email: 'operator@example.com',
  displayName: 'JourneyLens 管理员',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function unauthorizedResponse(): Response {
  return jsonResponse({ error: { code: 'AUTH_REQUIRED', message: '需要登录' } }, 401);
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
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('登录与会话路由', () => {
  it('未登录访问受保护页面跳转到 /login，显示空白登录表单，不预填凭据', async () => {
    fetchMock.mockResolvedValueOnce(unauthorizedResponse());
    const router = renderApp('/');

    expect(await screen.findByRole('heading', { name: '登录 JourneyLens' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('密码') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('button', { name: /演示账号|填入/ })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/userinfo', { credentials: 'same-origin' });
  });

  it('登录后进入工作台，退出成功后回到登录页', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorizedResponse())
      .mockResolvedValueOnce(jsonResponse({ data: account }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const router = renderApp('/');

    await screen.findByRole('heading', { name: '登录 JourneyLens' });
    submitCredentials();
    expect(await screen.findByText('JourneyLens 管理员')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByText('operator@example.com')).toBeTruthy();
    expect(screen.getByRole('banner').textContent).toContain('JourneyLens');
    expect(screen.getByRole('menuitem', { name: '活动' })).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(screen.getByRole('main', { name: '活动工作区' }).textContent).toBe('');
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('/api/campaigns');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/login');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      email: 'operator@example.com',
      password: 'correct-password',
    });

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    expect(await screen.findByRole('heading', { name: '登录 JourneyLens' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/auth/logout');
  });

  it('已登录访问 /login 会回到工作台', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: account }));
    const router = renderApp('/login');

    expect(await screen.findByText('JourneyLens 管理员')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/');
  });

  it('错误密码展示服务端的实际错误', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorizedResponse())
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码不正确' } }, 401),
      );
    renderApp('/');

    await screen.findByRole('heading', { name: '登录 JourneyLens' });
    submitCredentials();
    expect((await screen.findByRole('alert')).textContent).toContain('邮箱或密码不正确');
    expect(screen.getByRole('heading', { name: '登录 JourneyLens' })).toBeTruthy();
  });

  it('API 不可达时显示重试，不当作未登录；重试收到 401 后才进入登录页', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(unauthorizedResponse());
    const router = renderApp('/');

    expect(await screen.findByText('暂时无法连接服务')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '登录 JourneyLens' })).toBeNull();
    expect(router.state.location.pathname).toBe('/');
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByRole('heading', { name: '登录 JourneyLens' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('退出请求失败时显示错误并保留已登录账号', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: account }))
      .mockRejectedValueOnce(new TypeError('network unavailable'));
    const router = renderApp('/');

    expect(await screen.findByText('JourneyLens 管理员')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    expect((await screen.findByRole('alert')).textContent).toContain('无法连接服务器');
    expect(screen.getByText('JourneyLens 管理员')).toBeTruthy();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/');
  });
});
