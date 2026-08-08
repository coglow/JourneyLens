import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter } from 'react-router';
import { apiClient } from '@/services/api';
import { CampaignOverviewSection } from './CampaignOverviewSection';

const campaignId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb60';
const overview = {
  campaignId,
  executionCount: 12,
  audienceCount: 5,
  statusCounts: { running: 1, waiting: 2, completed: 6, failed: 1, stopped: 2 },
  goalReachedCount: 2,
};

let mock: MockAdapter;
let queryClient: QueryClient;

function renderSection() {
  render(
    <ConfigProvider locale={zhCN}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CampaignOverviewSection campaignId={campaignId} />
        </MemoryRouter>
      </QueryClientProvider>
    </ConfigProvider>,
  );
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  mock.restore();
});

describe('活动运行概览', () => {
  it('悬停标题旁的说明图标后才显示统计口径', async () => {
    const overviewHelp =
      '按最近一次读取的执行记录统计，可刷新查看变化。点击状态数字查看执行记录；已完成包含流程结束和目标达成后退出。';
    mock.onGet(`/campaigns/${campaignId}/overview`).reply(200, { data: overview });
    renderSection();

    expect(await screen.findByText('运行概览')).toBeDefined();
    expect(screen.queryByText(overviewHelp)).toBeNull();

    fireEvent.mouseEnter(screen.getByRole('button', { name: '运行概览说明' }));
    expect(await screen.findByText(overviewHelp)).toBeDefined();
  });

  it('悬停参与用户数旁的说明图标后才显示去重口径', async () => {
    const audienceHelp = '同一用户多次进入只计一人';
    mock.onGet(`/campaigns/${campaignId}/overview`).reply(200, { data: overview });
    renderSection();

    expect(await screen.findByText('参与用户数')).toBeDefined();
    expect(screen.queryByText(audienceHelp)).toBeNull();
    fireEvent.mouseEnter(screen.getByRole('button', { name: '参与用户数说明' }));

    expect(await screen.findByText(audienceHelp)).toBeDefined();
  });

  it('显示真实统计、按活动和状态下钻，并可手动刷新', async () => {
    mock.onGet(`/campaigns/${campaignId}/overview`).replyOnce(200, { data: overview });
    mock.onGet(`/campaigns/${campaignId}/overview`).reply(200, {
      data: {
        ...overview,
        executionCount: 13,
        statusCounts: { ...overview.statusCounts, waiting: 3 },
      },
    });
    renderSection();

    expect(await screen.findByText('12')).toBeDefined();
    expect(screen.getByText('5').closest('a')).toBeNull();
    expect(
      screen.getByRole('link', { name: '等待中 2，查看等待中的执行' }).getAttribute('href'),
    ).toBe(`/executions?campaignId=${campaignId}&status=waiting`);
    expect(screen.getByRole('link', { name: '执行总次数 12，查看全部执行' })).toBeDefined();
    expect(screen.getByRole('link', { name: '查看全部执行' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
    expect(await screen.findByText('13')).toBeDefined();
    await waitFor(() => expect(mock.history.get).toHaveLength(2));
  });

  it('刷新失败时保留上次数字并提示数据可能过期', async () => {
    mock.onGet(`/campaigns/${campaignId}/overview`).replyOnce(200, { data: overview });
    mock.onGet(`/campaigns/${campaignId}/overview`).reply(500, {
      error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId: 'test-request-id' },
    });
    renderSection();

    expect(await screen.findByText('12')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));

    expect(await screen.findByText('运行概览暂时无法刷新，当前数字可能不是最新的')).toBeDefined();
    expect(screen.getByText('12')).toBeDefined();
  });

  it('首次读取失败不显示零值，重试成功后显示真实统计', async () => {
    mock.onGet(`/campaigns/${campaignId}/overview`).replyOnce(500, {
      error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId: 'test-request-id' },
    });
    mock.onGet(`/campaigns/${campaignId}/overview`).reply(200, {
      data: {
        campaignId,
        executionCount: 0,
        audienceCount: 0,
        statusCounts: { running: 0, waiting: 0, completed: 0, failed: 0, stopped: 0 },
        goalReachedCount: null,
      },
    });
    renderSection();

    expect(await screen.findByText('运行概览暂时无法读取，请重试')).toBeDefined();
    expect(screen.queryByText('执行总次数')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));

    expect(await screen.findByRole('link', { name: '执行总次数 0，查看全部执行' })).toBeDefined();
    // 未设置目标时没有“达成次数”的含义，不能显示成 0 次。
    expect(screen.queryByText('目标达成次数')).toBeNull();
  });

  it('有目标时显示达成次数，包括真实的 0', async () => {
    mock.onGet(`/campaigns/${campaignId}/overview`).reply(200, {
      data: { ...overview, goalReachedCount: 0 },
    });
    renderSection();

    expect(await screen.findByText('目标达成次数')).toBeDefined();
    fireEvent.mouseEnter(screen.getByRole('button', { name: '目标达成次数说明' }));
    expect(
      await screen.findByText(
        '同一用户多次参与分别计数；这是参与达成次数，不代表订单数或实际转化。',
      ),
    ).toBeDefined();
  });
});
