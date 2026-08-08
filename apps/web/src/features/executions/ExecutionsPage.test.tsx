import { ThemeProvider } from '@/app/ThemeProvider';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

let mock: MockAdapter;
let queryClient: QueryClient | undefined;

const account = {
  id: 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120',
  email: 'operator@example.com',
  displayName: 'JourneyLens 管理员',
};
const campaignId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb60';
const journeyId = '8a2d4b6c-1e3f-4a5b-9c7d-2e4f6a8b0c1d';
const versionId = '22222222-2222-4222-8222-222222222222';
const executionId = '3f1c9f1e-2b7a-4d5c-8e9f-0a1b2c3d4e5f';

const campaignSummary = {
  id: campaignId,
  name: '演示活动',
  description: null,
  budget: null,
  goal: null,
  status: 'running',
  updatedAt: '2026-07-30T08:00:00.000Z',
  createdBy: { id: account.id, displayName: account.displayName },
  journeyCount: 1,
};
const journeySummary = {
  id: journeyId,
  name: '浏览后购买挽回',
  description: null,
  segment: null,
  versionCount: 1,
  updatedAt: '2026-07-30T08:00:00.000Z',
};

const waitingExecution = {
  id: executionId,
  audience: { externalId: 'upstream:demo:eligible', displayName: '霖铃铃' },
  campaign: { id: campaignId, name: '演示活动' },
  journey: { id: journeyId, name: '浏览后购买挽回' },
  version: { id: versionId, versionNumber: 2 },
  status: 'waiting',
  currentStep: { nodeId: 'wait-purchase', name: '等待同商品购买', nodeType: 'wait_for_event' },
  result: null,
  createdAt: '2026-07-30T08:00:00.000Z',
  startedAt: '2026-07-30T08:00:00.000Z',
  endedAt: null,
};

const completedExecution = {
  ...waitingExecution,
  id: '44444444-4444-4444-8444-444444444444',
  status: 'completed',
  currentStep: null,
  result: '超时分支完成',
  endedAt: '2026-07-30T08:01:05.000Z',
};

const emptyList = { data: [], page: { page: 1, pageSize: 10, total: 0 } };

function listBody(
  data: unknown[],
  pageOverrides: Partial<{ page: number; pageSize: number; total: number }> = {},
) {
  return {
    data,
    page: { page: 1, pageSize: 10, total: data.length, ...pageOverrides },
  };
}

function renderApp(initialPath = '/executions') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [initialPath] });

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

function executionParams() {
  return mock.history.get
    .filter((request) => request.url === '/executions')
    .map((request) => request.params as Record<string, unknown>);
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  mock.onGet('/userinfo').reply(200, { data: account });
  mock.onGet('/campaigns').reply(200, listBody([campaignSummary]));
});

afterEach(() => {
  cleanup();
  queryClient?.clear();
  queryClient = undefined;
  mock.restore();
});

describe('执行记录列表', () => {
  it('展示实际运行记录、当前步骤、结束结果和版本，空数据不填充假记录', async () => {
    mock.onGet('/executions').replyOnce(200, listBody([waitingExecution, completedExecution]));
    renderApp();

    expect((await screen.findAllByText('霖铃铃')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('upstream:demo:eligible').length).toBeGreaterThan(0);
    expect(screen.getByText('等待同商品购买')).toBeTruthy();
    expect(screen.getByText('超时分支完成')).toBeTruthy();
    expect(screen.getAllByText('等待中').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
    expect(screen.getAllByText('第 2 版')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: '查看执行轨迹' })).toHaveLength(2);
    expect(executionParams()[0]).toEqual({});
    expect(screen.getByPlaceholderText('搜索用户昵称或外部 ID')).toBeTruthy();
    expect(screen.getAllByPlaceholderText('开始时间')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /刷\s*新/ })).toBeTruthy();

    mock.onGet('/executions').replyOnce(200, emptyList);
    cleanup();
    queryClient?.clear();
    queryClient = undefined;
    renderApp();
    expect(await screen.findByText('暂无执行记录')).toBeTruthy();
  });

  it('从网址恢复搜索、状态、时间范围和分页', async () => {
    mock
      .onGet('/executions')
      .replyOnce(200, listBody([waitingExecution], { page: 2, pageSize: 20, total: 61 }));
    renderApp(
      '/executions?q=lin&status=waiting&createdFrom=2026-07-30T00%3A00%3A00.000Z&createdTo=2026-07-30T08%3A00%3A00.000Z&endedFrom=2026-07-30T09%3A00%3A00.000Z&page=2&pageSize=20',
    );

    expect(await screen.findByText('等待同商品购买')).toBeTruthy();
    expect(executionParams()[0]).toEqual({
      q: 'lin',
      status: 'waiting',
      createdFrom: '2026-07-30T00:00:00.000Z',
      createdTo: '2026-07-30T08:00:00.000Z',
      endedFrom: '2026-07-30T09:00:00.000Z',
      page: 2,
      pageSize: 20,
    });
    expect((screen.getByLabelText('关键词') as HTMLInputElement).value).toBe('lin');
    expect(screen.getByRole('combobox', { name: '状态' })).toBeTruthy();

    mock
      .onGet('/executions')
      .replyOnce(200, listBody([waitingExecution], { page: 3, pageSize: 20, total: 61 }));
    fireEvent.click(await screen.findByRole('listitem', { name: '3' }));
    await waitFor(() =>
      expect(executionParams()).toContainEqual({
        q: 'lin',
        status: 'waiting',
        createdFrom: '2026-07-30T00:00:00.000Z',
        createdTo: '2026-07-30T08:00:00.000Z',
        endedFrom: '2026-07-30T09:00:00.000Z',
        page: 3,
        pageSize: 20,
      }),
    );
  });

  it('选择活动和旅程后查询，筛选变化回到第一页', async () => {
    mock.onGet('/campaigns').reply(200, listBody([campaignSummary]));
    mock.onGet(`/campaigns/${campaignId}/journeys`).reply(200, listBody([journeySummary]));
    mock.onGet('/executions').reply(200, listBody([waitingExecution]));
    renderApp('/executions?page=2');

    await screen.findByText('等待同商品购买');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '活动' }));
    await waitFor(() => expect(screen.getAllByText('演示活动').length).toBeGreaterThan(1));
    const campaignOptions = screen.getAllByText('演示活动');
    fireEvent.click(campaignOptions[campaignOptions.length - 1]!);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: '旅程' }).hasAttribute('disabled')).toBe(false),
    );

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '旅程' }));
    await waitFor(() => expect(screen.getAllByText('浏览后购买挽回').length).toBeGreaterThan(1));
    const journeyOptions = screen.getAllByText('浏览后购买挽回');
    fireEvent.click(journeyOptions[journeyOptions.length - 1]!);
    fireEvent.click(screen.getByRole('button', { name: /^查\s*询$/ }));

    await waitFor(() =>
      expect(executionParams()).toContainEqual({
        campaignId,
        journeyId,
      }),
    );
  });

  it('非法分页参数明确报错且不发请求，读取失败可重试', async () => {
    renderApp('/executions?pageSize=17');
    expect(await screen.findByText('每页条数只能选择 10、20 或 50 条')).toBeTruthy();
    expect(executionParams()).toHaveLength(0);

    cleanup();
    queryClient?.clear();
    queryClient = undefined;
    mock.reset();
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/campaigns').reply(200, emptyList);
    mock.onGet('/executions').networkErrorOnce();
    mock.onGet('/executions').replyOnce(200, listBody([completedExecution]));
    renderApp();

    expect(await screen.findByText('无法连接服务器，请稍后重试')).toBeTruthy();
    expect(screen.queryByText('暂无执行记录')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByText('超时分支完成')).toBeTruthy();
  });

  it('从详情返回时恢复原筛选和页码', async () => {
    mock.onGet('/executions').reply(200, listBody([waitingExecution]));
    mock.onGet(`/executions/${executionId}/trace`).reply(404, {
      error: { code: 'NOT_FOUND', message: '执行记录不存在', requestId: 'test-request-id' },
    });
    const router = renderApp('/executions?q=lin&page=2&pageSize=20');

    fireEvent.click(await screen.findByRole('link', { name: '查看执行轨迹' }));
    expect(router.state.location.pathname).toBe(`/executions/${executionId}`);
    expect(router.state.location.state).toEqual({
      returnTo: '?q=lin&page=2&pageSize=20',
    });

    fireEvent.click(await screen.findByRole('button', { name: '返回执行记录' }));
    expect(router.state.location.pathname).toBe('/executions');
    expect(router.state.location.search).toBe('?q=lin&page=2&pageSize=20');
  });

  it('首页带入的失败时间保留秒和毫秒，查询、刷新及轨迹返回不截断范围', async () => {
    const from = '2026-07-30T06:30:12.345Z';
    const to = '2026-08-06T06:30:12.345Z';
    const params = new URLSearchParams({ status: 'failed', endedFrom: from, endedTo: to });
    mock
      .onGet('/executions')
      .reply(200, listBody([{ ...completedExecution, status: 'failed', result: '步骤执行失败' }]));
    mock.onGet(`/executions/${completedExecution.id}/trace`).reply(404, {
      error: { code: 'NOT_FOUND', message: '执行记录不存在', requestId: 'test-request-id' },
    });
    const router = renderApp(`/executions?${params}`);
    await screen.findByText('步骤执行失败');
    fireEvent.click(screen.getByRole('button', { name: /^查\s*询$/ }));
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('endedTo')).toBe(to),
    );
    fireEvent.click(screen.getByRole('button', { name: /刷\s*新/ }));
    await waitFor(() => expect(executionParams().length).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole('link', { name: '查看执行轨迹' }));
    fireEvent.click(await screen.findByRole('button', { name: '返回执行记录' }));
    await screen.findByText('步骤执行失败');
    expect(new URLSearchParams(router.state.location.search).get('endedFrom')).toBe(from);
    expect(new URLSearchParams(router.state.location.search).get('endedTo')).toBe(to);
    expect(
      executionParams().every((query) => query.endedFrom === from && query.endedTo === to),
    ).toBe(true);
  });
});
