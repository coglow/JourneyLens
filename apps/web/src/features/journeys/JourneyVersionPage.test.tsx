import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JourneyDraftDefinition, JourneyVersionDetail } from '@journeylens/shared';
import { JourneyVersionPage } from './JourneyVersionPage';
import { getJourneyVersion } from '@/services/journeys';
import { ApiError } from '@/services/api';

vi.mock('@/services/journeys', () => ({
  getJourneyVersion: vi.fn(),
}));

const accountId = 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120';
const journeyId = '88a0f727-a226-4cb4-9495-74364f8d0e33';
const versionId = '5c1e5c1a-9d0c-4d9c-8e5a-3f1e2d4c6b70';
const segmentId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb61';

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
    {
      id: 'n-message',
      type: 'message',
      name: '发送邮件',
      position: { x: 0, y: 140 },
      channel: 'email',
      subject: '版本验收',
      body: '第一版正文',
    },
    { id: 'n-end', type: 'end', name: '结束', position: { x: 0, y: 280 }, note: '完成触达' },
  ],
  edges: [
    { id: 'e-1', source: 'n-start', target: 'n-message' },
    { id: 'e-2', source: 'n-message', target: 'n-end' },
  ],
};

const version: JourneyVersionDetail = {
  id: versionId,
  journeyId,
  versionNumber: 1,
  sourceRevision: 2,
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

// jsdom 缺少测量连接点时读取的矩阵对象；只读画布同样需要它才能渲染节点。
beforeAll(() => {
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      readonly m22 = 1;
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

function SearchEcho() {
  const location = useLocation();
  return <div>版本列表{location.search}</div>;
}

type InitialEntry = string | { pathname: string; state?: unknown };

function renderPage(initialEntries: InitialEntry[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/journeys/:id/versions/:versionId', element: <JourneyVersionPage /> },
      { path: '/journeys/:id', element: <SearchEcho /> },
    ],
    { initialEntries },
  );
  render(
    <ConfigProvider locale={zhCN}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ConfigProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.mocked(getJourneyVersion).mockResolvedValue(version);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('已发布版本详情', () => {
  it('展示发布时的名称、分群规则和只读画布，不提供编辑控件', async () => {
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);

    expect(await screen.findByRole('heading', { name: '版本冻结验收', level: 2 })).toBeTruthy();
    expect(screen.getByText('第 1 版')).toBeTruthy();
    expect(screen.getByText('已发布 · 只读')).toBeTruthy();
    expect(screen.getByText('版本验收人群')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: '入口人群' })).queryByText(/年龄/)).toBeNull();
    expect(screen.getByText('此版本内容已固定')).toBeTruthy();
    fireEvent.focus(screen.getByRole('button', { name: '查看版本固定说明' }));
    expect(await screen.findByRole('tooltip')).toHaveProperty(
      'textContent',
      '已发布内容固定保存，不随当前编排或入口分群的修改而变化。',
    );
    expect(screen.getByTestId('rf__node-n-message')).toBeTruthy();

    // 历史版本只读：没有输入控件，也没有保存或恢复入口。
    expect(document.querySelector('input, textarea, select')).toBeNull();
    expect(screen.queryByRole('button', { name: /保存/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /恢复/ })).toBeNull();
  });

  it('选中步骤后展示快照里的完整配置', async () => {
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);

    fireEvent.click(await screen.findByTestId('rf__node-n-message'));

    expect(await screen.findByRole('heading', { name: '发送邮件' })).toBeTruthy();
    expect(screen.getByText('邮件', { exact: true })).toBeTruthy();
    expect(screen.getByText('邮件主题')).toBeTruthy();
    expect(screen.getByText('版本验收')).toBeTruthy();
    expect(screen.getByText('第一版正文')).toBeTruthy();
    expect(screen.getByTestId('rf__node-n-message').classList.contains('selected')).toBe(true);
  });

  it('行为筛选把规则内部值显示为编辑时选择的中文', async () => {
    vi.mocked(getJourneyVersion).mockResolvedValue({
      ...version,
      snapshot: {
        ...version.snapshot,
        definition: {
          ...definition,
          nodes: [
            definition.nodes[0]!,
            {
              id: 'n-category',
              type: 'condition',
              name: '按类目判断',
              position: { x: 0, y: 140 },
              rules: {
                kind: 'event_count',
                eventType: 'product_viewed',
                windowSeconds: 86_400,
                filter: { path: 'category', operator: 'eq', right: 'beauty' },
                sameProduct: false,
                operator: 'gte',
                right: 1,
              },
            },
            definition.nodes[1]!,
            definition.nodes[2]!,
          ],
          edges: [
            { id: 'e-1', source: 'n-start', target: 'n-category' },
            { id: 'e-2', source: 'n-category', target: 'n-message' },
            { id: 'e-3', source: 'n-message', target: 'n-end' },
          ],
        },
      },
    });
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);

    fireEvent.click(await screen.findByTestId('rf__node-n-category'));

    expect(await screen.findByText('商品类目 等于 美妆个护')).toBeTruthy();
    expect(screen.queryByText(/beauty/)).toBeNull();
  });

  it('键盘选择和取消选择步骤时同步配置与高亮', async () => {
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);
    const message = await screen.findByTestId('rf__node-n-message');

    fireEvent.keyDown(message, { key: 'Enter', code: 'Enter' });
    expect(await screen.findByText('第一版正文')).toBeTruthy();
    expect(message.classList.contains('selected')).toBe(true);

    const end = screen.getByTestId('rf__node-n-end');
    fireEvent.keyDown(end, { key: ' ', code: 'Space' });
    expect(await screen.findByRole('cell', { name: '完成触达' })).toBeTruthy();
    expect(message.classList.contains('selected')).toBe(false);
    expect(end.classList.contains('selected')).toBe(true);

    fireEvent.keyDown(end, { key: 'Escape', code: 'Escape' });
    expect(await screen.findByText('选择画布中的步骤查看完整配置。')).toBeTruthy();
    expect(end.classList.contains('selected')).toBe(false);
  });

  it('人群栏不展示规则摘要，打开侧栏后展示完整快照规则并保留或、排除关系', async () => {
    vi.mocked(getJourneyVersion).mockResolvedValue({
      ...version,
      snapshot: {
        ...version.snapshot,
        entrySegment: {
          ...version.snapshot.entrySegment!,
          rules: {
            kind: 'any',
            children: [ageRule, { kind: 'not', child: { ...ageRule, operator: 'lt', right: 25 } }],
          },
        },
      },
    });
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);

    const openRules = await screen.findByRole('button', { name: /查看完整规则/ });
    expect(within(screen.getByRole('region', { name: '入口人群' })).queryByText(/年龄/)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(openRules);

    const drawer = await screen.findByRole('dialog', { name: '发布时的入口分群规则' });
    expect(within(drawer).getByText('版本验收人群')).toBeTruthy();
    expect(within(drawer).getByText('任一满足')).toBeTruthy();
    expect(within(drawer).getByText('排除')).toBeTruthy();
    expect(within(drawer).getByText('25')).toBeTruthy();
    expect(getJourneyVersion).toHaveBeenCalledTimes(1);
  });

  it('不限人群时不提供空规则查看入口', async () => {
    vi.mocked(getJourneyVersion).mockResolvedValue({
      ...version,
      snapshot: { ...version.snapshot, entrySegment: null },
    });
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);

    expect(await screen.findByText('不限人群')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /查看完整规则/ })).toBeNull();
  });

  it('版本不存在时明确提示', async () => {
    vi.mocked(getJourneyVersion).mockRejectedValue(new ApiError(404, 'NOT_FOUND', '版本不存在'));
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);

    expect(await screen.findByText('版本不存在')).toBeTruthy();
  });

  it('返回版本列表时恢复原列表页码', async () => {
    renderPage([
      {
        pathname: `/journeys/${journeyId}/versions/${versionId}`,
        state: { versionListSearch: '?page=2' },
      },
    ]);

    fireEvent.click(await screen.findByRole('button', { name: /返回版本列表/ }));
    expect(await screen.findByText('版本列表?page=2')).toBeTruthy();
  });
});
