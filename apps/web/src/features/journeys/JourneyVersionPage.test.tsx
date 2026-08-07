import { ThemeProvider } from '@/app/ThemeProvider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  JourneyDraftDefinition,
  JourneyVersionDetail,
  JourneyVersionStats,
} from '@journeylens/shared';
import { JourneyVersionPage } from './JourneyVersionPage';
import { getJourneyVersion, getJourneyVersionStats } from '@/services/journeys';
import { ApiError } from '@/services/api';

vi.mock('@/services/journeys', () => ({
  getJourneyVersion: vi.fn(),
  getJourneyVersionStats: vi.fn(),
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

const stats: JourneyVersionStats = {
  executionCount: 4,
  audienceCount: 1,
  statusCounts: { running: 0, waiting: 1, completed: 3, failed: 0, stopped: 0 },
  nodes: [
    {
      nodeId: 'n-start',
      name: '开始',
      nodeType: 'start',
      entered: 4,
      completed: 4,
      waiting: 0,
      failed: 0,
      stopped: 0,
      conditionBranch: null,
      waitOutcome: null,
    },
    {
      nodeId: 'n-message',
      name: '发送邮件',
      nodeType: 'message',
      entered: 3,
      completed: 3,
      waiting: 0,
      failed: 0,
      stopped: 0,
      conditionBranch: null,
      waitOutcome: null,
    },
    {
      nodeId: 'n-end',
      name: '结束',
      nodeType: 'end',
      entered: 3,
      completed: 3,
      waiting: 0,
      failed: 0,
      stopped: 0,
      conditionBranch: null,
      waitOutcome: null,
    },
  ],
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

function StatsListEcho() {
  const location = useLocation();
  return <div>旅程统计{location.search}</div>;
}

type InitialEntry = string | { pathname: string; state?: unknown };

function renderPage(initialEntries: InitialEntry[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/journeys/:id/versions/:versionId', element: <JourneyVersionPage /> },
      { path: '/journeys/:id', element: <SearchEcho /> },
      { path: '/journey-stats', element: <StatsListEcho /> },
    ],
    { initialEntries },
  );
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.mocked(getJourneyVersion).mockResolvedValue(version);
  vi.mocked(getJourneyVersionStats).mockResolvedValue(stats);
});

afterEach(() => {
  cleanup();
  localStorage.removeItem('journeylens-color-mode');
  delete document.documentElement.dataset.colorMode;
  document.documentElement.style.removeProperty('background-color');
  vi.clearAllMocks();
});

describe('已发布版本详情', () => {
  it('展示发布时的名称、分群规则和只读画布，不提供编辑控件', async () => {
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);

    const heading = await screen.findByRole('heading', { name: /版本冻结验收/, level: 2 });
    expect(heading).toBeTruthy();
    expect(screen.getByRole('tab', { name: '流程视图' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByText('第 1 版')).toBeTruthy();
    expect(screen.getByText('已发布 · 只读')).toBeTruthy();
    expect(screen.getByText('版本验收人群')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: '入口人群' })).queryByText(/年龄/)).toBeNull();
    expect(heading.contains(screen.getByText('此版本内容已固定'))).toBe(true);
    fireEvent.focus(screen.getByRole('button', { name: '查看版本固定说明' }));
    expect(await screen.findByRole('tooltip')).toHaveProperty(
      'textContent',
      '已发布内容固定保存，不随当前编排或入口分群的修改而变化。',
    );
    expect(screen.getByTestId('rf__node-n-message')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '切换为深色模式' }));
    expect(document.querySelector('.react-flow')?.classList.contains('dark')).toBe(true);

    // 历史版本只读：只有名称查找框，没有配置输入、保存或恢复入口。
    expect(screen.getByRole('combobox', { name: '按步骤名称查找' })).toBeTruthy();
    expect(document.querySelector('textarea, select')).toBeNull();
    expect(screen.queryByRole('button', { name: /保存/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /恢复/ })).toBeNull();
  });

  it('选中步骤后展示快照里的完整配置', async () => {
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);

    fireEvent.click(await screen.findByTestId('rf__node-n-message'));

    expect(await screen.findByRole('heading', { name: '发送邮件' })).toBeTruthy();
    const stepPanel = screen.getByText('步骤统计').closest('.ant-card') as HTMLElement;
    expect(within(stepPanel).getByText('消息', { exact: true })).toBeTruthy();
    expect(within(stepPanel).getByText('消息触达 3 次')).toBeTruthy();
    fireEvent.click(screen.getByText('步骤配置'));
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
    fireEvent.click(screen.getByText('步骤配置'));

    expect(await screen.findByText('商品类目 等于 美妆个护')).toBeTruthy();
    expect(screen.queryByText(/beauty/)).toBeNull();
  });

  it('键盘选择和取消选择步骤时同步配置与高亮', async () => {
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);
    const message = await screen.findByTestId('rf__node-n-message');

    fireEvent.keyDown(message, { key: 'Enter', code: 'Enter' });
    fireEvent.click(screen.getByText('步骤配置'));
    expect(await screen.findByText('第一版正文')).toBeTruthy();
    expect(message.classList.contains('selected')).toBe(true);

    const end = screen.getByTestId('rf__node-n-end');
    fireEvent.keyDown(end, { key: ' ', code: 'Space' });
    expect(await screen.findByRole('cell', { name: '完成触达' })).toBeTruthy();
    expect(message.classList.contains('selected')).toBe(false);
    expect(end.classList.contains('selected')).toBe(true);

    fireEvent.keyDown(end, { key: 'Escape', code: 'Escape' });
    expect(await screen.findByText('选择画布中的步骤查看运行统计与配置')).toBeTruthy();
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
    expect(openRules.getAttribute('aria-expanded')).toBe('true');

    expect(await screen.findByText('发布时的入口分群规则')).toBeTruthy();
    expect(screen.getAllByText('版本验收人群')).toHaveLength(2);
    expect(screen.getByText('任一满足')).toBeTruthy();
    expect(screen.getByText('排除')).toBeTruthy();
    expect(screen.getByText('25')).toBeTruthy();
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

  it('运行统计展示汇总、完成占比与节点明细，角标与表格同源且不提供跳转', async () => {
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);
    fireEvent.click(await screen.findByRole('tab', { name: '统计明细' }));

    const summary = await screen.findByLabelText('版本运行汇总');
    expect(within(summary).getByText('执行次数')).toBeTruthy();
    expect(within(summary).getByText('参与用户数')).toBeTruthy();
    expect(within(summary).getByText('当前已完成占比 75%')).toBeTruthy();
    expect(screen.getByText('消息触达 3 次')).toBeTruthy();

    // 状态与节点数字只展示：不链接到执行列表，避免从当前版本误入其他版本的记录。
    expect(summary.querySelector('a')).toBeNull();

    // 角标取同一次统计数据：开始节点进入 4 次，消息和结束节点各 3 次，0 值也照常显示。
    expect(screen.getByText('进入 4 次')).toBeTruthy();
    expect(screen.getAllByText('进入 3 次')).toHaveLength(2);
    expect(screen.getByRole('cell', { name: '消息触达 3 次' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '流程视图' }));
    fireEvent.click(screen.getByRole('tab', { name: '统计明细' }));
    expect(getJourneyVersionStats).toHaveBeenCalledTimes(1);
    expect(within(summary).getByText('当前已完成占比 75%')).toBeTruthy();
  });

  it('没有执行记录时说明尚无执行，节点行与角标仍显示 0', async () => {
    vi.mocked(getJourneyVersionStats).mockResolvedValue({
      executionCount: 0,
      audienceCount: 0,
      statusCounts: { running: 0, waiting: 0, completed: 0, failed: 0, stopped: 0 },
      nodes: stats.nodes.map((node) => ({
        ...node,
        entered: 0,
        completed: 0,
        waiting: 0,
        failed: 0,
        stopped: 0,
      })),
    });
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);
    fireEvent.click(await screen.findByRole('tab', { name: '统计明细' }));

    expect(await screen.findByText('该版本还没有执行记录')).toBeTruthy();
    expect(screen.queryByText(/当前已完成占比/)).toBeNull();
    expect(screen.getAllByText('进入 0 次')).toHaveLength(3);
    // 未读到统计和统计为 0 是两件事：这里表格仍有全部节点行。
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('统计读取失败时不影响版本内容，重试成功后补上数字与角标', async () => {
    vi.mocked(getJourneyVersionStats)
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', '服务暂时不可用'))
      .mockResolvedValueOnce(stats);
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);

    expect(await screen.findByText('运行统计暂时无法读取，请重试')).toBeTruthy();
    expect(screen.getByTestId('rf__node-n-message')).toBeTruthy();
    expect(screen.queryByText(/进入 \d+ 次/)).toBeNull();

    // antd 会在两个汉字的按钮文字中间插入空格，按正则匹配。
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));

    expect(await screen.findByText('当前已完成占比 75%')).toBeTruthy();
    expect(screen.getByText('进入 4 次')).toBeTruthy();
  });

  it('刷新失败时保留上次数字并提示可能不是最新的', async () => {
    vi.mocked(getJourneyVersionStats)
      .mockResolvedValueOnce(stats)
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', '服务暂时不可用'));
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);

    expect(await screen.findByText('当前已完成占比 75%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));

    expect(getJourneyVersionStats).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('运行统计暂时无法刷新，当前数字可能不是最新的')).toBeTruthy();
    expect(screen.getByText('当前已完成占比 75%')).toBeTruthy();
  });

  it('返回版本列表时恢复原列表页码', async () => {
    renderPage([
      {
        pathname: `/journeys/${journeyId}/versions/${versionId}`,
        state: { versionListSearch: '?page=2' },
      },
    ]);

    await screen.findByRole('heading', { name: /版本冻结验收/, level: 2 });
    expect(screen.getByRole('tab', { name: '流程视图' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    fireEvent.click(await screen.findByRole('button', { name: /返回版本列表/ }));
    expect(await screen.findByText('版本列表?page=2')).toBeTruthy();
  });

  it('从旅程统计入口进入时返回旅程统计，并恢复原查询条件', async () => {
    renderPage([
      {
        pathname: `/journeys/${journeyId}/versions/${versionId}`,
        state: { fromJourneyStats: { search: '?q=%E6%8C%BD%E5%9B%9E&page=2' } },
      },
    ]);

    expect(await screen.findByRole('heading', { name: /版本冻结验收/, level: 2 })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /返回旅程统计/ }));
    expect(await screen.findByText('旅程统计?q=%E6%8C%BD%E5%9B%9E&page=2')).toBeTruthy();
  });

  it('从旅程统计入口进入默认打开明细，版本身份与详情及统计请求一致', async () => {
    renderPage([
      {
        pathname: `/journeys/${journeyId}/versions/${versionId}`,
        state: { fromJourneyStats: { search: '?page=1' } },
      },
    ]);

    await screen.findByRole('heading', { name: /版本冻结验收/, level: 2 });
    expect(screen.getByRole('tab', { name: '统计明细' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByText('第 1 版')).toBeTruthy();
    expect(vi.mocked(getJourneyVersion).mock.calls[0]?.[1]).toBe(versionId);
    expect(vi.mocked(getJourneyVersionStats).mock.calls[0]?.[1]).toBe(versionId);
  });

  it('明细查找按名称筛选，点击步骤切换到流程并保留选择，清空后恢复全部行', async () => {
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);
    fireEvent.click(await screen.findByRole('tab', { name: '统计明细' }));
    const search = screen.getByRole('combobox', { name: '按步骤名称查找' });

    fireEvent.change(search, { target: { value: '发送' } });
    expect(await screen.findByRole('cell', { name: '发送邮件' })).toBeTruthy();
    expect(screen.queryByRole('cell', { name: '开始' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '发送邮件' }));

    expect(screen.getByRole('tab', { name: '流程视图' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('heading', { name: '发送邮件' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '统计明细' }));
    expect((search as HTMLInputElement).value).toBe('发送');
    expect(screen.getByRole('cell', { name: '发送邮件' })).toBeTruthy();
    fireEvent.change(search, { target: { value: '' } });
    expect(await screen.findByRole('button', { name: '开始' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '流程视图' }));
    expect(screen.getByRole('heading', { name: '发送邮件' })).toBeTruthy();
    expect(screen.getByTestId('rf__node-n-message').classList.contains('selected')).toBe(true);
  });

  it('多个同名步骤显示类型和顺序，选择后定位到指定步骤', async () => {
    const duplicateId = 'n-duplicate';
    const duplicateDefinition: JourneyDraftDefinition = {
      ...definition,
      nodes: [
        { ...definition.nodes[0]!, name: '重复步骤' },
        {
          id: duplicateId,
          type: 'condition',
          name: '重复步骤',
          position: { x: 0, y: 140 },
          rules: ageRule,
        },
        { ...definition.nodes[1]!, position: { x: 0, y: 280 } },
        { ...definition.nodes[2]!, position: { x: 0, y: 420 } },
      ],
      edges: [
        { id: 'e-1', source: 'n-start', target: duplicateId },
        { id: 'e-2', source: duplicateId, target: 'n-message' },
        { id: 'e-3', source: 'n-message', target: 'n-end' },
      ],
    };
    const duplicateStats: JourneyVersionStats = {
      ...stats,
      nodes: [
        { ...stats.nodes[0]!, name: '重复步骤' },
        {
          nodeId: duplicateId,
          name: '重复步骤',
          nodeType: 'condition',
          entered: 4,
          completed: 4,
          waiting: 0,
          failed: 0,
          stopped: 0,
          conditionBranch: { met: 3, unmet: 1 },
          waitOutcome: null,
        },
        { ...stats.nodes[1]!, entered: 4, completed: 4 },
        { ...stats.nodes[2]!, entered: 4, completed: 4 },
      ],
    };
    vi.mocked(getJourneyVersion).mockResolvedValue({
      ...version,
      snapshot: { ...version.snapshot, definition: duplicateDefinition },
    });
    vi.mocked(getJourneyVersionStats).mockResolvedValue(duplicateStats);
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);

    const search = await screen.findByRole('combobox', { name: '按步骤名称查找' });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: '重复' } });
    const result = await screen.findByText(/第\s*2\s*步/);
    fireEvent.click(result);

    expect(screen.getByRole('tab', { name: '流程视图' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('heading', { name: '重复步骤' })).toBeTruthy();
    const detailPanel = screen.getByText('步骤统计').closest('.ant-card') as HTMLElement;
    expect(within(detailPanel).getByText('条件分支', { exact: true })).toBeTruthy();
    expect(within(detailPanel).getByText('满足 3 / 不满足 1')).toBeTruthy();
    expect(screen.getByTestId(`rf__node-${duplicateId}`).classList.contains('selected')).toBe(true);
    expect((search as HTMLInputElement).value).toBe('重复');
  });

  it('切换视图保留明细表滚动容器', async () => {
    renderPage([`/journeys/${journeyId}/versions/${versionId}`]);
    fireEvent.click(await screen.findByRole('tab', { name: '统计明细' }));
    await screen.findByRole('cell', { name: '发送邮件' });
    const tableBody = document.querySelector('.ant-table-body') as HTMLDivElement;
    tableBody.scrollTop = 80;

    fireEvent.click(screen.getByRole('tab', { name: '流程视图' }));
    fireEvent.click(screen.getByRole('tab', { name: '统计明细' }));

    expect(document.querySelector('.ant-table-body')).toBe(tableBody);
    expect(tableBody.scrollTop).toBe(80);
  });
});
