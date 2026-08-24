import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Overview } from '@journeylens/shared';
import MockAdapter from 'axios-mock-adapter';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { MemoryRouter } from 'react-router';
import { apiClient } from '@/services/api';
import { formatDateTime } from '@/utils/format-date-time';
import { OverviewPage } from './OverviewPage';

const campaignId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb60';
const data: Overview = {
  windowStartedAt: '2026-07-30T06:30:12.345Z',
  windowEndedAt: '2026-08-06T06:30:12.345Z',
  campaignStatusCounts: { draft: 3, running: 8, paused: 2, stopped: 4 },
  entryCount: 120,
  goalReachedCount: 26,
  failedCount: 5,
  recentJourneys: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: '新客首购旅程',
      campaign: { id: campaignId, name: '新客引导', status: 'running' },
      versionId: '44444444-4444-4444-8444-444444444444',
      versionNumber: 2,
      publishedAt: '2026-07-27T02:00:00.000Z',
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      name: '沉默用户唤醒旅程',
      campaign: {
        id: '11111111-1111-4111-8111-111111111111',
        name: '回访活动',
        status: 'paused',
      },
      versionId: '66666666-6666-4666-8666-666666666666',
      versionNumber: 1,
      publishedAt: '2026-07-25T02:00:00.000Z',
    },
  ],
  recentCampaigns: [
    {
      id: campaignId,
      name: '新客引导',
      status: 'running',
      entryCount: 40,
      goalReachedCount: 0,
      failedCount: 3,
    },
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: '回访活动',
      status: 'paused',
      entryCount: 10,
      goalReachedCount: null,
      failedCount: 0,
    },
  ],
};
let mock: MockAdapter;
let client: QueryClient;

function renderPage() {
  render(
    <ConfigProvider locale={zhCN}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </QueryClientProvider>
    </ConfigProvider>,
  );
}

function linkParams(name: string) {
  const href = screen.getByRole('link', { name }).getAttribute('href')!;
  return new URL(href, 'http://localhost').searchParams;
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  mock.restore();
});

describe('首页运营概览', () => {
  it('展示实际数字和进行中的旅程，无目标与零达成不混淆', async () => {
    mock.onGet('/overview').reply(200, { data });
    renderPage();
    const entered = await screen.findByRole('link', { name: '近 7 天进入旅程 120 次，查看记录' });
    expect(entered.textContent).toContain('120');
    expect(screen.getByText('26')).toBeTruthy();
    expect(screen.getByText('近期旅程')).toBeTruthy();
    const latest = data.recentJourneys[0]!;
    expect(
      screen.getByRole('link', {
        name: `${latest.name}，${latest.campaign.name}，第 ${latest.versionNumber} 版，${formatDateTime(latest.publishedAt)} 发布，查看版本运行情况`,
      }),
    ).toBeTruthy();
    expect(screen.getByText(/新客引导 · 第 2 版/)).toBeTruthy();
    expect(screen.getByText(/回访活动 · 第 1 版/)).toBeTruthy();
    const first = screen.getByRole('link', { name: '新客引导' }).closest('tr')!;
    const second = screen.getByRole('link', { name: '回访活动' }).closest('tr')!;
    expect(within(first).getByText('0')).toBeTruthy();
    expect(within(second).getByText('未设置')).toBeTruthy();
    expect(within(second).getByText('已暂停')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '运营概览' })).toBeTruthy();
    const updatedTime = screen.getByText(/^更新于 /);
    expect(updatedTime.getAttribute('datetime')).toBe(data.windowEndedAt);
    expect(updatedTime.getAttribute('title')).toBe(formatDateTime(data.windowEndedAt));
    expect(updatedTime.textContent).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    const dateRange = screen.getByText(/^近 7 天 ·/);
    expect(dateRange.textContent).not.toContain(':');
    expect(dateRange.getAttribute('title')).toBe(
      `${formatDateTime(data.windowStartedAt)} — ${formatDateTime(data.windowEndedAt)}`,
    );
    // 没有说明文案的指标不显示说明图标，避免出现空提示。
    expect(screen.queryByRole('button', { name: '当前进行中活动说明' })).toBeNull();
    fireEvent.focus(screen.getByRole('button', { name: '近 7 天目标达成说明' }));
    expect(
      await screen.findByText(
        '统计近 7 天达成活动目标的次数，按达成时间计算；同一用户多次达成分别计数。',
      ),
    ).toBeTruthy();
  });

  it('活动概况总数及四状态能筛选活动，其他记录链接保留对应范围', async () => {
    mock.onGet('/overview').reply(200, { data });
    renderPage();
    await screen.findByRole('link', { name: '新客引导' });
    const latest = data.recentJourneys[0]!;
    expect(screen.getByRole('link', { name: '新客引导' }).getAttribute('href')).toBe(
      `/campaigns/${campaignId}`,
    );
    expect(linkParams('当前进行中活动 8 个，查看记录').get('status')).toBe('running');
    expect(Object.fromEntries(linkParams('近 7 天进入旅程 120 次，查看记录'))).toEqual({
      createdFrom: data.windowStartedAt,
      createdTo: data.windowEndedAt,
    });
    expect(Object.fromEntries(linkParams('近 7 天执行失败 5 次，查看记录'))).toEqual({
      status: 'failed',
      endedFrom: data.windowStartedAt,
      endedTo: data.windowEndedAt,
    });
    expect(Object.fromEntries(linkParams('新客引导失败 3 次，查看执行记录'))).toEqual({
      campaignId,
      status: 'failed',
      endedFrom: data.windowStartedAt,
      endedTo: data.windowEndedAt,
    });
    expect(screen.getByText('26').closest('a')).toBeNull();
    expect(screen.getByRole('img', { name: '活动状态分布，共 17 个活动' })).toBeTruthy();
    expect(
      screen
        .getByRole('link', {
          name: `${latest.name}，${latest.campaign.name}，第 ${latest.versionNumber} 版，${formatDateTime(latest.publishedAt)} 发布，查看版本运行情况`,
        })
        .getAttribute('href'),
    ).toBe(`/journeys/${latest.id}/versions/${latest.versionId}`);
    expect(
      screen.getByRole('link', { name: '活动总数 17 个，查看全部活动' }).getAttribute('href'),
    ).toBe('/campaigns');
    for (const [label, count, status] of [
      ['草稿', 3, 'draft'],
      ['进行中', 8, 'running'],
      ['已暂停', 2, 'paused'],
      ['已停止', 4, 'stopped'],
    ]) {
      expect(
        screen
          .getByRole('link', { name: `${label}活动 ${count} 个，查看活动` })
          .getAttribute('href'),
      ).toBe(`/campaigns?status=${status}`);
    }
    expect(screen.queryByText('常用入口')).toBeNull();
    expect(screen.queryByRole('link', { name: '查看旅程统计' })).toBeNull();
  });

  it('首次读取中不显示假零，读取失败可重试，成功后展示真实空状态', async () => {
    let finish!: () => void;
    mock.onGet('/overview').replyOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve([500, {}]);
        }),
    );
    mock.onGet('/overview').reply(200, {
      data: {
        ...data,
        campaignStatusCounts: { draft: 0, running: 1, paused: 0, stopped: 0 },
        entryCount: 0,
        goalReachedCount: 0,
        failedCount: 0,
        recentJourneys: [],
        recentCampaigns: [],
      },
    });
    renderPage();
    // 首次读取用骨架占位，数据到达后才渲染真实卡片。
    expect(
      screen.getByRole('status', { name: '正在读取概览' }).querySelector('.ant-skeleton'),
    ).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByRole('link', { name: /活动总数/ })).toBeNull();
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    finish();
    expect(await screen.findByText('概览暂时无法读取，请重试')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByText('近 7 天还没有进入旅程的记录')).toBeTruthy();
    expect(screen.getByText('还没有发布过的旅程')).toBeTruthy();
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
    expect(screen.getByRole('link', { name: '当前进行中活动 1 个，查看记录' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '活动总数 1 个，查看全部活动' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '草稿活动 0 个，查看活动' })).toBeTruthy();
  });

  it('仅在手动刷新成功后显示一条成功提示，首次读取和刷新中不提示成功', async () => {
    mock.onGet('/overview').replyOnce(200, { data });
    let finish!: () => void;
    mock.onGet('/overview').replyOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve([200, { data: { ...data, entryCount: 121 } }]);
        }),
    );
    renderPage();
    await screen.findByText('120');
    expect(screen.queryByText('数据已刷新')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(screen.queryByText('数据已刷新')).toBeNull();
    finish();

    expect((await screen.findByText('数据已刷新')).closest('.ant-message-success')).toBeTruthy();
    expect(screen.getAllByText('数据已刷新')).toHaveLength(1);
    expect(await screen.findByText('121')).toBeTruthy();
    expect(mock.history.get).toHaveLength(2);
  });

  it('停留在页面时每 30 秒静默更新数字与更新时间', async () => {
    const updated = {
      ...data,
      entryCount: 121,
      windowStartedAt: '2026-07-30T06:32:15.678Z',
      windowEndedAt: '2026-08-06T06:32:15.678Z',
    };
    mock.onGet('/overview').replyOnce(200, { data });
    mock.onGet('/overview').reply(200, { data: updated });

    vi.useFakeTimers();
    try {
      renderPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText('120')).toBeTruthy();

      await act(async () => {
        // 推进 30 秒触发轮询；多 1 毫秒让响应后的更新时间在假时钟下送达页面。
        await vi.advanceTimersByTimeAsync(30_001);
      });

      expect(mock.history.get).toHaveLength(2);
      expect(screen.getByText('121')).toBeTruthy();
      expect(screen.getByText(/^更新于 /).getAttribute('datetime')).toBe(updated.windowEndedAt);
      expect(screen.queryByText('数据已刷新')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('刷新中保留数字，失败保留旧范围和链接，重试成功后整份数据一起更新', async () => {
    mock.onGet('/overview').replyOnce(200, { data });
    let finish!: () => void;
    mock.onGet('/overview').replyOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve([500, {}]);
        }),
    );
    const updated = {
      ...data,
      campaignStatusCounts: { ...data.campaignStatusCounts, running: 9 },
      entryCount: 121,
      windowStartedAt: '2026-07-30T06:32:15.678Z',
      windowEndedAt: '2026-08-06T06:32:15.678Z',
    };
    mock.onGet('/overview').reply(200, { data: updated });
    renderPage();
    await screen.findByText('120');
    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(screen.getByText('120')).toBeTruthy();
    finish();
    expect(await screen.findByText('概览暂时无法刷新，当前数字可能不是最新的')).toBeTruthy();
    expect(screen.queryByText('数据已刷新')).toBeNull();
    expect(screen.getByRole('link', { name: '进行中活动 8 个，查看活动' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '当前进行中活动 8 个，查看记录' })).toBeTruthy();
    expect(linkParams('近 7 天执行失败 5 次，查看记录').get('endedTo')).toBe(data.windowEndedAt);
    expect(screen.getByText(/^更新于 /).getAttribute('datetime')).toBe(data.windowEndedAt);
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByText('121')).toBeTruthy();
    expect(screen.getByRole('link', { name: '进行中活动 9 个，查看活动' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '当前进行中活动 9 个，查看记录' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '活动总数 18 个，查看全部活动' })).toBeTruthy();
    expect(linkParams('新客引导失败 3 次，查看执行记录').get('endedTo')).toBe(
      updated.windowEndedAt,
    );
    expect(screen.getByText(/^更新于 /).getAttribute('datetime')).toBe(updated.windowEndedAt);
    expect(screen.queryByText('概览暂时无法刷新，当前数字可能不是最新的')).toBeNull();
    expect(mock.history.get).toHaveLength(3);
  });

  it.each([
    ['执行失败为负数', { ...data, failedCount: -1 }],
    [
      '活动数量为负数',
      { ...data, campaignStatusCounts: { ...data.campaignStatusCounts, draft: -1 } },
    ],
    ['缺少活动状态', { ...data, campaignStatusCounts: { running: 8, paused: 2, stopped: 4 } }],
  ])('拒绝错误响应：%s', async (_name, invalid) => {
    mock.onGet('/overview').reply(200, { data: invalid });
    renderPage();
    expect(await screen.findByText('概览暂时无法读取，请重试')).toBeTruthy();
    expect(screen.queryByText('-1')).toBeNull();
    expect(screen.queryByText('新客引导')).toBeNull();
  });
});
