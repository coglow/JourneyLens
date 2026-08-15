import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  JourneyVersionDetail,
  JourneyVersionSnapshot,
  JourneyVersionSummary,
} from '@journeylens/shared';
import { JourneyVersionCompareDrawer } from './JourneyVersionCompareDrawer';
import { getJourneyVersion, getJourneyVersions } from '@/services/journeys';
import { ApiError } from '@/services/api';

vi.mock('@/services/journeys', () => ({
  getJourneyVersion: vi.fn(),
  getJourneyVersions: vi.fn(),
}));

const journeyId = '88a0f727-a226-4cb4-9495-74364f8d0e33';
const accountId = 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120';

function versionId(versionNumber: number): string {
  return `00000000-0000-4000-8000-00000000000${versionNumber}`;
}

function makeSummary(versionNumber: number): JourneyVersionSummary {
  return {
    id: versionId(versionNumber),
    journeyId,
    versionNumber,
    sourceRevision: versionNumber + 1,
    sourceSegmentRevision: null,
    publishedAt: `2026-07-2${versionNumber}T08:00:00.000Z`,
    publishedBy: { id: accountId, displayName: '运营账号' },
  };
}

function makeSnapshot(body: string): JourneyVersionSnapshot {
  return {
    name: '新客旅程',
    description: null,
    entrySegment: null,
    definition: {
      layoutDirection: 'vertical',
      nodes: [
        {
          id: 'start',
          type: 'start',
          name: '进入',
          position: { x: 0, y: 0 },
          entryBehavior: 'registration_completed',
        },
        {
          id: 'message',
          type: 'message',
          name: '欢迎短信',
          position: { x: 0, y: 100 },
          channel: 'sms',
          subject: null,
          body,
        },
        { id: 'end', type: 'end', name: '结束', position: { x: 0, y: 200 }, note: null },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'message' },
        { id: 'e2', source: 'message', target: 'end' },
      ],
    },
  };
}

function makeDetail(versionNumber: number, body: string): JourneyVersionDetail {
  return {
    ...makeSummary(versionNumber),
    snapshot: makeSnapshot(body),
  };
}

function renderDrawer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ConfigProvider locale={zhCN}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/journeys/${journeyId}`]}>
          <JourneyVersionCompareDrawer open journeyId={journeyId} onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    </ConfigProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <pre data-testid="location-state">{JSON.stringify(location.state)}</pre>;
}

function renderDrawerWithRoutes(search: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ConfigProvider locale={zhCN}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/journeys/${journeyId}${search}`]}>
          <Routes>
            <Route
              path="/journeys/:id"
              element={
                <JourneyVersionCompareDrawer open journeyId={journeyId} onClose={() => {}} />
              }
            />
            <Route path="/journeys/:id/versions/:versionId" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ConfigProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getJourneyVersions).mockResolvedValue({
    data: [makeSummary(2), makeSummary(1)],
    page: { page: 1, pageSize: 50, total: 2 },
  });
  vi.mocked(getJourneyVersion).mockImplementation((_journeyId, id) =>
    Promise.resolve(
      makeDetail(id === versionId(2) ? 2 : 1, id === versionId(2) ? '新的正文' : '旧正文'),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('版本对比抽屉', () => {
  it('按第一页读取版本，默认对比最新两版并展示变更', async () => {
    renderDrawer();

    expect(await screen.findByText('修改步骤')).toBeTruthy();
    expect(screen.getByText('「欢迎短信」')).toBeTruthy();
    expect(screen.getAllByText('第 2 版').length).toBeGreaterThan(0);
    expect(screen.getAllByText('第 1 版').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/运营账号 发布于/).length).toBeGreaterThanOrEqual(2);

    // 默认值来自抽屉自己的第一页请求，不受背景列表分页影响。
    expect(getJourneyVersions).toHaveBeenCalledWith(
      journeyId,
      { page: 1, pageSize: 50 },
      expect.anything(),
    );
    expect(getJourneyVersion).toHaveBeenCalledWith(journeyId, versionId(2), expect.anything());
    expect(getJourneyVersion).toHaveBeenCalledWith(journeyId, versionId(1), expect.anything());
  });

  it('两版内容一致时提示流程配置没有差异', async () => {
    vi.mocked(getJourneyVersion).mockResolvedValue(makeDetail(1, '同一份正文'));

    renderDrawer();

    expect(await screen.findByText('两个版本的流程配置没有差异')).toBeTruthy();
  });

  it('版本超过选择范围时说明只显示最近 50 个版本', async () => {
    vi.mocked(getJourneyVersions).mockResolvedValue({
      data: [makeSummary(61), makeSummary(60)],
      page: { page: 1, pageSize: 50, total: 61 },
    });

    renderDrawer();

    expect(await screen.findByText('仅显示最近 50 个版本，更早的版本暂不支持对比。')).toBeTruthy();
  });

  it('只有一个版本时说明不足以对比', async () => {
    vi.mocked(getJourneyVersions).mockResolvedValue({
      data: [makeSummary(1)],
      page: { page: 1, pageSize: 50, total: 1 },
    });

    renderDrawer();

    expect(await screen.findByText('至少发布两个版本后才能对比。')).toBeTruthy();
  });

  it('读取失败时给出提示并可重试', async () => {
    let attempts = 0;
    vi.mocked(getJourneyVersion).mockImplementation((_journeyId, id) => {
      attempts += 1;
      if (attempts <= 2) {
        return Promise.reject(new ApiError(500, 'INTERNAL_ERROR', '服务暂时不可用'));
      }
      return Promise.resolve(
        makeDetail(id === versionId(2) ? 2 : 1, id === versionId(2) ? '新的正文' : '旧正文'),
      );
    });

    renderDrawer();

    expect(await screen.findByText('服务暂时不可用')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(screen.getByText('修改步骤')).toBeTruthy());
  });

  it('两版信息提供进入版本详情的链接', async () => {
    renderDrawer();

    const olderLink = await screen.findByRole('link', { name: '第 1 版' });
    expect(olderLink.getAttribute('href')).toBe(`/journeys/${journeyId}/versions/${versionId(1)}`);
    const newerLink = screen.getByRole('link', { name: '第 2 版' });
    expect(newerLink.getAttribute('href')).toBe(`/journeys/${journeyId}/versions/${versionId(2)}`);
  });

  it('进入版本详情时带上列表分页状态，返回列表可回到原页', async () => {
    renderDrawerWithRoutes('?page=2');

    fireEvent.click(await screen.findByRole('link', { name: '第 2 版' }));

    const probe = await screen.findByTestId('location-state');
    expect(probe.textContent).toContain('"versionListSearch":"?page=2"');
  });

  it('候选列表读取失败时只重试列表，不请求空版本', async () => {
    vi.mocked(getJourneyVersions).mockRejectedValueOnce(
      new ApiError(500, 'INTERNAL_ERROR', '服务暂时不可用'),
    );

    renderDrawer();

    expect(await screen.findByText('服务暂时不可用')).toBeTruthy();
    // 没有候选版本时不能继续显示读取中，也不能拿空标识去请求详情。
    expect(screen.queryByRole('status', { name: '正在读取版本对比' })).toBeNull();
    expect(getJourneyVersion).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByText('修改步骤')).toBeTruthy();
    expect(getJourneyVersion).toHaveBeenCalledWith(journeyId, versionId(2), expect.anything());
  });
});
