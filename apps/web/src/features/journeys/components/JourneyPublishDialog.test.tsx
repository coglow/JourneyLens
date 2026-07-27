import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider, Modal } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  JourneyDetail,
  JourneyDraftDefinition,
  JourneyVersionDetail,
} from '@journeylens/shared';
import { JourneyPublishDialog } from './JourneyPublishDialog';
import { getJourney, publishJourney } from '@/services/journeys';
import { ApiError } from '@/services/api';

vi.mock('@/services/journeys', () => ({
  getJourney: vi.fn(),
  publishJourney: vi.fn(),
}));

const accountId = 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120';
const journeyId = '88a0f727-a226-4cb4-9495-74364f8d0e33';
const segmentId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb61';
const versionId = '5c1e5c1a-9d0c-4d9c-8e5a-3f1e2d4c6b70';

const ageRule = {
  kind: 'compare' as const,
  left: { source: 'user' as const, path: 'age' as const },
  operator: 'gte' as const,
  right: 18,
};

const definition: JourneyDraftDefinition = {
  layoutDirection: 'vertical',
  nodes: [
    {
      id: 'n-start',
      type: 'start',
      name: '开始',
      position: { x: 0, y: 0 },
      entryBehavior: 'app_session_started',
    },
    { id: 'n-end', type: 'end', name: '结束', position: { x: 0, y: 120 }, note: null },
  ],
  edges: [{ id: 'e-1', source: 'n-start', target: 'n-end' }],
};

function makeJourney(revision = 8, segmentRevision = 3): JourneyDetail {
  return {
    id: journeyId,
    name: '版本冻结验收',
    description: '验收发布版本',
    revision,
    campaign: { id: segmentId, name: '发布活动', status: 'draft' },
    segment: { id: segmentId, name: '版本验收人群', revision: segmentRevision, rules: ageRule },
    draftDefinition: definition,
    createdAt: '2026-07-23T08:00:00.000Z',
    updatedAt: '2026-07-23T08:00:00.000Z',
    createdBy: { id: accountId, displayName: '运营账号' },
    updatedBy: { id: accountId, displayName: '运营账号' },
  };
}

const publishedVersion: JourneyVersionDetail = {
  id: versionId,
  journeyId,
  versionNumber: 1,
  sourceRevision: 8,
  sourceSegmentRevision: 3,
  publishedAt: '2026-07-23T08:00:00.000Z',
  publishedBy: { id: accountId, displayName: '运营账号' },
  snapshot: {
    name: '版本冻结验收',
    description: '验收发布版本',
    definition,
    entrySegment: { id: segmentId, name: '版本验收人群', revision: 3, rules: ageRule },
  },
};

function renderDialog(overrides: { revision?: number; blockReason?: string } = {}) {
  const onReadLatest = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ConfigProvider locale={zhCN}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/journeys']}>
          <JourneyPublishDialog
            journeyId={journeyId}
            revision={overrides.revision ?? 8}
            blockReason={overrides.blockReason}
            onReadLatest={onReadLatest}
          />
        </MemoryRouter>
      </QueryClientProvider>
    </ConfigProvider>,
  );
  return { onReadLatest };
}

function openDialog(): void {
  fireEvent.click(screen.getByRole('button', { name: '发布版本' }));
}

beforeEach(() => {
  vi.mocked(getJourney).mockResolvedValue(makeJourney());
  vi.mocked(publishJourney).mockResolvedValue(publishedVersion);
});

afterEach(() => {
  cleanup();
  Modal.destroyAll();
  vi.clearAllMocks();
});

describe('发布版本确认', () => {
  it('不可发布时按钮禁用，说明原因', () => {
    renderDialog({ blockReason: '请先保存当前修改' });
    expect((screen.getByRole('button', { name: '发布版本' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('打开时重新读取旅程，确认后只提交两个修订号', async () => {
    renderDialog();
    openDialog();

    expect(await screen.findByText('版本冻结验收')).toBeTruthy();
    expect(screen.getByText('版本验收人群')).toBeTruthy();
    expect(getJourney).toHaveBeenCalledWith(journeyId, expect.anything());

    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));
    await waitFor(() =>
      expect(publishJourney).toHaveBeenCalledWith(journeyId, {
        revision: 8,
        segmentRevision: 3,
      }),
    );

    expect(await screen.findByText('已发布第 1 版')).toBeTruthy();
    const link = screen.getByRole('link', { name: '查看该版本' });
    expect(link.getAttribute('href')).toBe(`/journeys/${journeyId}/versions/${versionId}`);
  });

  it('旅程已被修改时停止发布，并提供读取最新内容', async () => {
    vi.mocked(getJourney).mockResolvedValue(makeJourney(9));
    const { onReadLatest } = renderDialog();
    openDialog();

    expect(await screen.findByText('旅程已在其他页面修改，请重新读取后再发布')).toBeTruthy();
    expect((screen.getByRole('button', { name: '确认发布' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: '读取最新内容' }));
    expect(onReadLatest).toHaveBeenCalledTimes(1);
    expect(publishJourney).not.toHaveBeenCalled();
  });

  it('发布时发现旅程被修改：给出提示并可读取最新内容', async () => {
    vi.mocked(publishJourney).mockRejectedValue(
      new ApiError(409, 'JOURNEY_REVISION_CONFLICT', '旅程已在其他页面修改，请重新读取后再发布'),
    );
    const { onReadLatest } = renderDialog();
    openDialog();
    await screen.findByText('版本冻结验收');

    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));
    expect(await screen.findByText('旅程已在其他页面修改，请重新读取后再发布')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '读取最新内容' }));
    expect(onReadLatest).toHaveBeenCalledTimes(1);
  });

  it('分群在确认后被修改时要求重新读取分群规则', async () => {
    vi.mocked(publishJourney).mockRejectedValue(
      new ApiError(
        409,
        'JOURNEY_SEGMENT_REVISION_CONFLICT',
        '入口分群已修改，请重新确认分群规则后再发布',
      ),
    );
    renderDialog();
    openDialog();
    await screen.findByText('版本冻结验收');

    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));
    expect(await screen.findByText('入口分群已修改，请重新确认分群规则后再发布')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect(getJourney).toHaveBeenCalledTimes(2));
  });

  it('发布处理中重复点击不会重复提交', async () => {
    let resolvePublish: ((value: JourneyVersionDetail) => void) | undefined;
    vi.mocked(publishJourney).mockImplementation(
      () =>
        new Promise<JourneyVersionDetail>((resolve) => {
          resolvePublish = resolve;
        }),
    );
    renderDialog();
    openDialog();
    await screen.findByText('版本冻结验收');

    const confirm = screen.getByRole('button', { name: '确认发布' }) as HTMLButtonElement;
    fireEvent.click(confirm);
    await waitFor(() => expect(publishJourney).toHaveBeenCalledTimes(1));
    expect(confirm.disabled).toBe(true);

    fireEvent.click(confirm);
    expect(publishJourney).toHaveBeenCalledTimes(1);

    resolvePublish?.(publishedVersion);
    expect(await screen.findByText('已发布第 1 版')).toBeTruthy();
  });
});
