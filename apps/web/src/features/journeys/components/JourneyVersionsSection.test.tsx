import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JourneyVersionSummary } from '@journeylens/shared';
import { JourneyVersionsSection } from './JourneyVersionsSection';
import { getJourneyVersions } from '@/services/journeys';
import { ApiError } from '@/services/api';

vi.mock('@/services/journeys', () => ({
  getJourneyVersions: vi.fn(),
}));

const journeyId = '88a0f727-a226-4cb4-9495-74364f8d0e33';
const accountId = 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120';

function makeVersion(versionNumber: number): JourneyVersionSummary {
  return {
    id: `00000000-0000-4000-8000-00000000000${versionNumber}`,
    journeyId,
    versionNumber,
    sourceRevision: versionNumber + 1,
    sourceSegmentRevision: null,
    publishedAt: `2026-07-2${versionNumber}T08:00:00.000Z`,
    publishedBy: { id: accountId, displayName: '运营账号' },
  };
}

function renderSection(path = `/journeys/${journeyId}`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ConfigProvider locale={zhCN}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <JourneyVersionsSection journeyId={journeyId} />
        </MemoryRouter>
      </QueryClientProvider>
    </ConfigProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getJourneyVersions).mockResolvedValue({
    data: [makeVersion(2), makeVersion(1)],
    page: { page: 2, pageSize: 10, total: 12 },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('已发布版本列表', () => {
  it('按网址页码读取并展示版本、发布人和查看入口', async () => {
    renderSection(`/journeys/${journeyId}?page=2`);

    expect(await screen.findByText('第 2 版')).toBeTruthy();
    expect(screen.getByText('第 1 版')).toBeTruthy();
    expect(screen.getAllByText('运营账号')).toHaveLength(2);
    expect(screen.getByText('共 12 个版本')).toBeTruthy();
    expect(getJourneyVersions).toHaveBeenCalledWith(
      journeyId,
      { page: '2', pageSize: undefined },
      expect.anything(),
    );

    const link = screen.getAllByRole('link', { name: '查看版本' })[0]!;
    expect(link.getAttribute('href')).toBe(`/journeys/${journeyId}/versions/${makeVersion(2).id}`);
  });

  it('没有版本时显示空状态，不展示分页', async () => {
    vi.mocked(getJourneyVersions).mockResolvedValue({
      data: [],
      page: { page: 1, pageSize: 10, total: 0 },
    });
    renderSection();

    expect(await screen.findByText('尚未发布版本')).toBeTruthy();
    expect(screen.queryByText(/共 \d+ 个版本/)).toBeNull();
  });

  it('读取失败时明确提示并可重试，不伪装成空列表', async () => {
    vi.mocked(getJourneyVersions)
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', '服务暂时不可用'))
      .mockResolvedValueOnce({
        data: [makeVersion(1)],
        page: { page: 1, pageSize: 10, total: 1 },
      });
    renderSection();

    expect(await screen.findByText('服务暂时不可用')).toBeTruthy();
    expect(screen.queryByText('尚未发布版本')).toBeNull();

    // antd 会在两个汉字的按钮文案之间插入空格，按文本内容匹配更稳妥。
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(screen.getByText('第 1 版')).toBeTruthy());
  });
});
