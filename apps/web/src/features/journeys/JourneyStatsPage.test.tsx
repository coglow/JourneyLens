import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthProvider } from '@/features/auth/auth-provider';
import { QueryProvider } from '@/app/QueryProvider';
import { appRoutes } from '@/app/router';
import { apiClient } from '@/services/api';

let mock: MockAdapter;
let queryClient: QueryClient | undefined;

const account = {
  id: 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120',
  email: 'operator@example.com',
  displayName: 'JourneyLens 管理员',
};
const campaignId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb60';
const otherCampaignId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb61';
const firstJourneyId = '88a0f727-a226-4cb4-9495-74364f8d0e33';
const firstVersionId = '3f1f2b8c-5c2c-4e57-9a8b-7a0f2f3f4b01';

const campaign = {
  id: campaignId,
  name: '浏览挽回活动',
  description: '演示活动',
  budget: null,
  status: 'running',
  createdAt: '2026-07-17T08:00:00.000Z',
  updatedAt: '2026-07-17T08:00:00.000Z',
  createdBy: { id: account.id, displayName: account.displayName },
  goal: null,
  goalEditable: true,
};

const firstItem = {
  id: firstJourneyId,
  name: '浏览后购买挽回',
  campaign: { id: campaignId, name: campaign.name, status: 'running' },
  latestVersion: { id: firstVersionId, versionNumber: 3, publishedAt: '2026-07-20T08:00:00.000Z' },
};

const secondItem = {
  id: '88a0f727-a226-4cb4-9495-74364f8d0e34',
  name: '复购提醒',
  campaign: { id: otherCampaignId, name: '复购活动', status: 'draft' },
  latestVersion: {
    id: '3f1f2b8c-5c2c-4e57-9a8b-7a0f2f3f4b02',
    versionNumber: 1,
    publishedAt: '2026-07-21T08:00:00.000Z',
  },
};

function listBody(data: unknown[] = [], page = 1, pageSize = 10, total = data.length) {
  return { data, page: { page, pageSize, total } };
}

function renderApp(initialPath = '/journey-stats') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [initialPath] });

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

function readSearch(router: ReturnType<typeof renderApp>) {
  return new URLSearchParams(router.state.location.search);
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

describe('旅程统计入口', () => {
  it('列出旅程名称、所属活动和最新发布版本，查看统计指向该版本页', async () => {
    mock.onGet('/journey-stats').replyOnce(200, listBody([firstItem, secondItem], 1, 10, 2));
    renderApp();

    expect(await screen.findByText('浏览后购买挽回')).toBeTruthy();
    expect(screen.getByText('复购提醒')).toBeTruthy();
    expect(screen.getByText('浏览挽回活动')).toBeTruthy();
    expect(screen.getByText('复购活动')).toBeTruthy();
    expect(screen.getByRole('link', { name: '浏览挽回活动' }).getAttribute('href')).toBe(
      `/campaigns/${campaignId}`,
    );
    expect(screen.getByRole('link', { name: '复购活动' }).getAttribute('href')).toBe(
      `/campaigns/${otherCampaignId}`,
    );
    expect(screen.getByText('第 3 版')).toBeTruthy();
    expect(screen.getByText('第 1 版')).toBeTruthy();
    expect(screen.getByText('共 2 个旅程')).toBeTruthy();

    const links = screen.getAllByRole('link', { name: '查看统计' });
    expect(links[0]?.getAttribute('href')).toBe(
      `/journeys/${firstJourneyId}/versions/${firstVersionId}`,
    );
    // 统计入口只打开最新版本，历史版本仍从版本列表查看。
    expect(screen.queryByText(/第 2 版/)).toBeNull();
  });

  it('按网址恢复关键词、活动、页码与每页条数，并据此请求', async () => {
    mock
      .onGet('/journey-stats')
      .replyOnce(200, listBody([firstItem], 2, 20, 25))
      .onGet(`/campaigns/${campaignId}`)
      .replyOnce(200, { data: campaign });
    renderApp(`/journey-stats?q=%E6%8C%BD%E5%9B%9E&campaignId=${campaignId}&page=2&pageSize=20`);

    expect(await screen.findByText('浏览后购买挽回')).toBeTruthy();
    expect((screen.getByLabelText('关键词') as HTMLInputElement).value).toBe('挽回');
    // 活动下拉按网址里的活动标识取回名称，刷新后仍显示活动名而不是标识。
    const campaignInput = screen.getByLabelText('所属活动');
    expect(
      within(campaignInput.closest('.ant-select') as HTMLElement).getByText('浏览挽回活动'),
    ).toBeTruthy();
    await waitFor(() => {
      expect(mock.history.get.map((request) => request.url)).toContain(`/campaigns/${campaignId}`);
    });

    await waitFor(() => {
      expect(mock.history.get.map((request) => request.url)).toContain('/journey-stats');
    });
    const listRequest = mock.history.get.find((request) => request.url === '/journey-stats');
    expect(listRequest?.params).toEqual({
      q: '挽回',
      campaignId,
      page: 2,
      pageSize: 20,
    });
  });

  it('提交关键词后回到第一页，重置清空全部筛选条件', async () => {
    mock.onGet('/journey-stats').reply(200, listBody([firstItem], 1, 20, 1));
    mock.onGet(`/campaigns/${campaignId}`).reply(200, { data: campaign });
    const router = renderApp(`/journey-stats?campaignId=${campaignId}&page=2&pageSize=20`);

    await screen.findByText('浏览后购买挽回');
    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: '  挽回  ' } });
    fireEvent.click(screen.getByRole('button', { name: /查\s*询/ }));

    await waitFor(() => {
      const params = readSearch(router);
      expect(params.get('q')).toBe('挽回');
      expect(params.get('page')).toBeNull();
      expect(params.get('campaignId')).toBe(campaignId);
    });

    fireEvent.click(screen.getByRole('button', { name: /重\s*置/ }));

    await waitFor(() => {
      const params = readSearch(router);
      expect(params.get('q')).toBeNull();
      expect(params.get('campaignId')).toBeNull();
      expect(params.get('page')).toBeNull();
      // 每页条数不属于筛选条件，重置后保留。
      expect(params.get('pageSize')).toBe('20');
    });
  });

  it('切换页码写入网址，并从服务端页码恢复', async () => {
    mock.onGet('/journey-stats').reply((config) => {
      const page = Number(config.params?.page ?? 1);
      return [200, listBody([firstItem], page, 10, 25)];
    });
    const router = renderApp();

    await screen.findByText('浏览后购买挽回');
    // antd 的分页项是不带 href 的 <a>，没有链接角色，按 title 点击页码。
    fireEvent.click(screen.getByTitle('2'));

    await waitFor(() => {
      expect(readSearch(router).get('page')).toBe('2');
    });
    await waitFor(() => {
      expect(mock.history.get.some((request) => request.params?.page === 2)).toBe(true);
    });
  });

  it('区分“暂无已发布版本的旅程”和“没有符合条件的旅程”两种空态', async () => {
    mock.onGet('/journey-stats').reply(200, listBody());
    const router = renderApp();

    expect(await screen.findByText('暂无已发布版本的旅程')).toBeTruthy();

    router.navigate('/journey-stats?q=%E6%8C%BD%E5%9B%9E');
    expect(await screen.findByText('没有符合条件的旅程')).toBeTruthy();
  });

  it('读取失败时说明原因并可重试', async () => {
    mock.onGet('/journey-stats').replyOnce(500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务暂时不可用，请稍后重试',
        requestId: 'test-request-id',
      },
    });
    renderApp();

    expect(await screen.findByText('服务暂时不可用，请稍后重试')).toBeTruthy();

    mock.onGet('/journey-stats').replyOnce(200, listBody([firstItem]));
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByText('浏览后购买挽回')).toBeTruthy();
  });
});
