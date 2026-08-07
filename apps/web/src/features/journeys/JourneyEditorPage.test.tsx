import { ThemeProvider } from '@/app/ThemeProvider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Modal } from 'antd';
import type {
  JourneyDetail,
  JourneyDraftDefinition,
  JourneySimulationResult,
} from '@journeylens/shared';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JourneyEditorPage } from './JourneyEditorPage';
import {
  generateJourneyAiDraft,
  getJourney,
  saveJourneyDraft,
  simulateJourney,
} from '@/services/journeys';
import { ApiError } from '@/services/api';
import { journeyQueryKeys } from './journey-queries';

vi.mock('@/services/journeys', () => ({
  getJourney: vi.fn(),
  saveJourneyDraft: vi.fn(),
  simulateJourney: vi.fn(),
  publishJourney: vi.fn(),
  generateJourneyAiDraft: vi.fn(),
}));

const journeyId = '88a0f727-a226-4cb4-9495-74364f8d0e33';
const journey: JourneyDetail = {
  id: journeyId,
  name: '欢迎旅程',
  description: null,
  revision: 1,
  campaign: { id: '2d4f4d57-9d59-4ed5-a2fa-d71733cebb60', name: '春季活动', status: 'draft' },
  segment: null,
  draftDefinition: null,
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
  createdBy: { id: 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120', displayName: '管理员' },
  updatedBy: { id: 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120', displayName: '管理员' },
};

let queryClient: QueryClient | undefined;

const aiCandidate: JourneyDraftDefinition = {
  layoutDirection: 'vertical',
  nodes: [
    {
      id: 'ai-start',
      type: 'start',
      name: 'AI 开始',
      position: { x: 0, y: 0 },
      entryBehavior: 'product_viewed',
    },
    { id: 'ai-end', type: 'end', name: 'AI 结束', position: { x: 0, y: 200 }, note: null },
  ],
  edges: [{ id: 'ai-edge', source: 'ai-start', target: 'ai-end' }],
};

// jsdom 缺少测量连接点时读取的矩阵对象；页面测试默认缩放为 1，真实几何另做浏览器验证。
beforeAll(() => {
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      readonly m22 = 1;
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient = client;
  const router = createMemoryRouter(
    [
      { path: '/journeys/:id/:view', element: <JourneyEditorPage /> },
      { path: '/journeys/:id', element: <div>旅程详情</div> },
      { path: '/journeys/:id/versions/:versionId', element: <div>版本详情</div> },
      { path: '/campaigns/:id', element: <div>活动详情</div> },
    ],
    { initialEntries: [`/journeys/${journeyId}/editor`] },
  );
  const view = render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { ...view, router };
}

async function applyAiDraft() {
  vi.mocked(getJourney).mockResolvedValue({ ...journey, draftDefinition: aiCandidate });
  vi.mocked(generateJourneyAiDraft).mockResolvedValue({
    status: 'ready',
    draftDefinition: aiCandidate,
  });
  const { router } = renderEditor();
  await screen.findByRole('heading', { name: '欢迎旅程' });
  fireEvent.click(screen.getByRole('button', { name: /AI 生成旅程/ }));
  await screen.findByRole('heading', { name: 'AI 起草' });
  fireEvent.change(screen.getByLabelText('旅程描述'), { target: { value: '浏览后结束' } });
  fireEvent.click(screen.getByRole('button', { name: '生成方案' }));
  fireEvent.click(await screen.findByRole('button', { name: '应用并保存草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '替换并保存' }));
  return router;
}

function dispatchShortcut(
  element: HTMLElement,
  key: string,
  modifiers: Pick<KeyboardEventInit, 'ctrlKey' | 'metaKey' | 'shiftKey'> = {},
): KeyboardEvent {
  element.focus();
  expect(document.activeElement === element).toBe(true);
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  element.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.mocked(getJourney).mockResolvedValue(journey);
  // 页面默认开启自动保存；没有单独覆盖的用例也需要一个可成功的保存响应。
  vi.mocked(saveJourneyDraft).mockImplementation(async (_id, input) => ({
    ...journey,
    revision: 2,
    updatedAt: '2026-07-24T06:30:00.000Z',
    draftDefinition: input.draftDefinition,
  }));
});

afterEach(() => {
  Modal.destroyAll();
  cleanup();
  localStorage.removeItem('journeylens-color-mode');
  delete document.documentElement.dataset.colorMode;
  document.documentElement.style.removeProperty('background-color');
  queryClient?.clear();
  vi.clearAllMocks();
});

describe('旅程编排页面', () => {
  it('编排切换主题保留画布节点，进入和返回 AI 起草沿用主题且不保存草稿', async () => {
    const { router } = renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    const nodes = document.querySelectorAll('.react-flow__node');
    fireEvent.click(screen.getByRole('button', { name: '切换为深色模式' }));
    expect(document.querySelector('.react-flow')?.classList.contains('dark')).toBe(true);
    expect(document.querySelectorAll('.react-flow__node')[0]).toBe(nodes[0]);
    expect(vi.mocked(saveJourneyDraft)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /AI 生成旅程/ }));
    await screen.findByRole('heading', { name: 'AI 起草' });
    expect(router.state.location.pathname).toBe(`/journeys/${journeyId}/ai-draft`);
    expect(screen.getByRole('button', { name: '切换为浅色模式' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^返回编排$/ }));
    expect(router.state.location.pathname).toBe(`/journeys/${journeyId}/editor`);
    expect(document.documentElement.dataset.colorMode).toBe('dark');
  });

  it('起草保存冲突后取消读取保留候选，读取成功后才允许返回', async () => {
    vi.mocked(getJourney).mockResolvedValue({ ...journey, draftDefinition: aiCandidate });
    vi.mocked(generateJourneyAiDraft).mockResolvedValue({
      status: 'ready',
      draftDefinition: aiCandidate,
    });
    vi.mocked(saveJourneyDraft).mockRejectedValueOnce(
      new ApiError(409, 'JOURNEY_REVISION_CONFLICT', '旅程已更新'),
    );
    const { router } = renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    fireEvent.click(screen.getByRole('button', { name: /AI 生成旅程/ }));
    await screen.findByRole('heading', { name: 'AI 起草' });
    fireEvent.change(screen.getByLabelText('旅程描述'), { target: { value: '浏览后结束' } });
    fireEvent.click(screen.getByRole('button', { name: '生成方案' }));
    fireEvent.click(await screen.findByRole('button', { name: '应用并保存草稿' }));
    fireEvent.click(await screen.findByRole('button', { name: '替换并保存' }));
    await screen.findByText('旅程已在其他页面修改，你的内容仍保留在本页。读取最新内容前会先确认。');
    expect(screen.getByRole('button', { name: /^返回编排$/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '读取最新内容' }));
    fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/流程检查通过/)).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/journeys/${journeyId}/ai-draft`);

    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      revision: 2,
      draftDefinition: aiCandidate,
    });
    fireEvent.click(screen.getByRole('button', { name: '读取最新内容' }));
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: '读取最新内容' }));
    await waitFor(() =>
      expect((screen.getByLabelText('旅程描述') as HTMLTextAreaElement).value).toBe(''),
    );
    fireEvent.click(screen.getByRole('button', { name: /^返回编排$/ }));
    expect(await screen.findByLabelText('开始：AI 开始')).toBeTruthy();
    expect(screen.queryByText('放弃本次起草？')).toBeNull();
  });

  it.each(['TIMEOUT', 'NETWORK_ERROR'])(
    '起草保存%s后修改描述仍需核实，读取成功后恢复保存',
    async (code) => {
      vi.mocked(saveJourneyDraft).mockRejectedValueOnce(
        new ApiError(undefined, code, '暂时无法确认保存结果'),
      );
      const router = await applyAiDraft();
      await screen.findByText('本次保存结果未确认，请读取最新内容核实');
      fireEvent.change(screen.getByLabelText('旅程描述'), { target: { value: '修改后的要求' } });

      expect(screen.getByText('本次保存结果未确认，请读取最新内容核实')).toBeTruthy();
      expect(screen.getByRole('button', { name: /^返回编排$/ }).hasAttribute('disabled')).toBe(
        true,
      );
      expect(screen.getByRole('button', { name: '生成方案' }).hasAttribute('disabled')).toBe(true);
      await act(async () => {
        await router.navigate(`/journeys/${journeyId}/editor`);
      });
      const leave = await screen.findByRole('dialog');
      expect(
        within(leave).getByRole('button', { name: '放弃并离开' }).hasAttribute('disabled'),
      ).toBe(true);
      fireEvent.click(within(leave).getByRole('button', { name: '留在此页' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      vi.mocked(getJourney).mockResolvedValue({
        ...journey,
        revision: 2,
        draftDefinition: aiCandidate,
      });
      fireEvent.click(screen.getByRole('button', { name: '读取最新内容' }));
      fireEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: '读取最新内容' }),
      );
      await waitFor(() =>
        expect((screen.getByLabelText('旅程描述') as HTMLTextAreaElement).value).toBe(''),
      );
      fireEvent.click(screen.getByRole('button', { name: /^返回编排$/ }));
      fireEvent.click(await screen.findByLabelText('结束：AI 结束'));
      fireEvent.change(await screen.findByLabelText('节点名称'), {
        target: { value: '核实后的结束' },
      });
      fireEvent.click(screen.getByRole('button', { name: '保存编排' }));
      await waitFor(() => expect(saveJourneyDraft).toHaveBeenCalledTimes(2));
      expect(saveJourneyDraft).toHaveBeenLastCalledWith(
        journeyId,
        expect.objectContaining({
          revision: 2,
          draftDefinition: expect.objectContaining({
            nodes: expect.arrayContaining([expect.objectContaining({ name: '核实后的结束' })]),
          }),
        }),
      );
    },
  );

  it('起草核实时读取失败会显示原因，重试成功后解除保护', async () => {
    vi.mocked(saveJourneyDraft).mockRejectedValueOnce(
      new ApiError(409, 'JOURNEY_REVISION_CONFLICT', '旅程已更新'),
    );
    await applyAiDraft();
    await screen.findByText('旅程已在其他页面修改，你的内容仍保留在本页。读取最新内容前会先确认。');
    vi.mocked(getJourney).mockRejectedValueOnce(
      new ApiError(undefined, 'NETWORK_ERROR', '无法连接服务器，请稍后重试'),
    );
    fireEvent.click(screen.getByRole('button', { name: '读取最新内容' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '读取最新内容' }),
    );
    await screen.findByText('无法连接服务器，请稍后重试');
    expect(screen.getByText(/流程检查通过/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^返回编排$/ }).hasAttribute('disabled')).toBe(true);

    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      revision: 2,
      draftDefinition: aiCandidate,
    });
    fireEvent.click(screen.getByRole('button', { name: '读取最新内容' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '读取最新内容' }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('旅程描述') as HTMLTextAreaElement).value).toBe(''),
    );
    expect(screen.queryByText('无法连接服务器，请稍后重试')).toBeNull();
    expect(screen.getByRole('button', { name: /^返回编排$/ }).hasAttribute('disabled')).toBe(false);
  });

  it('起草核实发现旅程已删除时显示原因，并允许确认后离开', async () => {
    vi.mocked(saveJourneyDraft).mockRejectedValueOnce(
      new ApiError(409, 'JOURNEY_REVISION_CONFLICT', '旅程已更新'),
    );
    const router = await applyAiDraft();
    await screen.findByText('旅程已在其他页面修改，你的内容仍保留在本页。读取最新内容前会先确认。');
    vi.mocked(getJourney).mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', '旅程不存在'));
    fireEvent.click(screen.getByRole('button', { name: '读取最新内容' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '读取最新内容' }),
    );
    await screen.findByText('旅程已不存在，当前内容无法保存。');
    expect(screen.getByRole('button', { name: /^返回编排$/ }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: '应用并保存草稿' }).hasAttribute('disabled')).toBe(
      true,
    );
    await act(async () => {
      await router.navigate(`/campaigns/${journey.campaign.id}`);
    });
    const leave = await screen.findByRole('dialog');
    const confirm = within(leave).getByRole('button', { name: '放弃并离开' });
    expect(confirm.hasAttribute('disabled')).toBe(false);
    fireEvent.click(confirm);
    expect(await screen.findByText('活动详情')).toBeTruthy();
    expect(saveJourneyDraft).toHaveBeenCalledTimes(1);
  });

  it('生成中离开确认后丢弃迟到结果，重新进入保持空白', async () => {
    let resolve:
      ((value: { status: 'ready'; draftDefinition: JourneyDraftDefinition }) => void) | undefined;
    vi.mocked(getJourney).mockResolvedValue({ ...journey, draftDefinition: aiCandidate });
    vi.mocked(generateJourneyAiDraft).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    fireEvent.click(screen.getByRole('button', { name: /AI 生成旅程/ }));
    await screen.findByRole('heading', { name: 'AI 起草' });
    fireEvent.change(screen.getByLabelText('旅程描述'), { target: { value: '浏览后结束' } });
    fireEvent.click(screen.getByRole('button', { name: '生成方案' }));
    await screen.findByText('正在生成方案，请稍候…');
    fireEvent.click(screen.getByRole('button', { name: /^返回编排$/ }));
    await screen.findAllByText('方案还在生成，仍要离开？');
    fireEvent.click(screen.getByRole('button', { name: '放弃并离开' }));
    await screen.findByRole('button', { name: /AI 生成旅程/ });
    await act(async () => {
      resolve?.({ status: 'ready', draftDefinition: aiCandidate });
    });
    fireEvent.click(screen.getByRole('button', { name: /AI 生成旅程/ }));
    await screen.findByRole('heading', { name: 'AI 起草' });
    expect((screen.getByLabelText('旅程描述') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByRole('button', { name: '应用并保存草稿' })).toBeNull();
  });

  it('独立起草路由保留原画布未保存内容，返回时只确认放弃起草输入', async () => {
    const { router } = renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    fireEvent.click(screen.getByRole('button', { name: '添加消息' }));
    expect(await screen.findByText('消息内容不能为空')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /AI 生成旅程/ }));
    expect(await screen.findByRole('heading', { name: 'AI 起草' })).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/journeys/${journeyId}/ai-draft`);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(screen.getByLabelText('旅程描述'), { target: { value: '尚未生成的要求' } });
    fireEvent.click(screen.getByRole('button', { name: /^返回编排$/ }));
    expect((await screen.findAllByText('放弃本次起草？')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((screen.getByLabelText('旅程描述') as HTMLTextAreaElement).value).toBe('尚未生成的要求');
    fireEvent.click(screen.getByRole('button', { name: /^返回编排$/ }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃并离开' }));
    expect(await screen.findByRole('button', { name: '保存编排' })).toBeTruthy();
    expect(screen.getByLabelText('消息：消息')).toBeTruthy();
    expect(saveJourneyDraft).not.toHaveBeenCalled();
    await act(async () => {
      await router.navigate(`/campaigns/${journey.campaign.id}`);
    });
    expect((await screen.findAllByText('放弃未保存的修改？')).length).toBeGreaterThan(0);
  });

  it('浏览器返回同样保护起草内容，刷新保护与空页返回正确释放', async () => {
    const { router } = renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    fireEvent.click(screen.getByRole('button', { name: /AI 生成旅程/ }));
    await screen.findByRole('heading', { name: 'AI 起草' });
    fireEvent.change(screen.getByLabelText('旅程描述'), { target: { value: '浏览后提醒' } });
    const refresh = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(refresh);
    expect(refresh.defaultPrevented).toBe(true);
    await act(async () => {
      await router.navigate(-1);
    });
    fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.pathname).toBe(`/journeys/${journeyId}/ai-draft`);
    await act(async () => {
      await router.navigate(-1);
    });
    fireEvent.click(await screen.findByRole('button', { name: '放弃并离开' }));
    await screen.findByRole('button', { name: /AI 生成旅程/ });
    const cleanRefresh = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanRefresh);
    expect(cleanRefresh.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /AI 生成旅程/ }));
    await screen.findByRole('heading', { name: 'AI 起草' });
    expect((screen.getByLabelText('旅程描述') as HTMLTextAreaElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: /^返回编排$/ }));
    await screen.findByRole('button', { name: /AI 生成旅程/ });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('起草应用复用保存，成功后返回编排显示新流程', async () => {
    const definition: JourneyDraftDefinition = {
      layoutDirection: 'vertical',
      nodes: [
        {
          id: 'ai-start',
          type: 'start',
          name: 'AI 开始',
          position: { x: 0, y: 0 },
          entryBehavior: 'product_viewed',
        },
        { id: 'ai-end', type: 'end', name: 'AI 结束', position: { x: 0, y: 200 }, note: null },
      ],
      edges: [{ id: 'ai-edge', source: 'ai-start', target: 'ai-end' }],
    };
    vi.mocked(generateJourneyAiDraft).mockResolvedValue({
      status: 'ready',
      draftDefinition: definition,
    });
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    fireEvent.click(screen.getByRole('button', { name: /AI 生成旅程/ }));
    await screen.findByRole('heading', { name: 'AI 起草' });
    fireEvent.mouseDown(screen.getByLabelText('进入行为'));
    fireEvent.click(
      await screen.findByText('浏览商品', { selector: '.ant-select-item-option-content' }),
    );
    fireEvent.change(screen.getByLabelText('旅程描述'), { target: { value: '浏览后结束' } });
    fireEvent.click(screen.getByRole('button', { name: '生成方案' }));
    expect(await screen.findByText(/流程检查通过/)).toBeTruthy();
    expect(saveJourneyDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '应用并保存草稿' }));
    expect(await screen.findByLabelText('开始：AI 开始')).toBeTruthy();
    expect(saveJourneyDraft).toHaveBeenCalledWith(
      journeyId,
      expect.objectContaining({ revision: 1 }),
    );
    expect(await screen.findByLabelText('开始：AI 开始')).toBeTruthy();
    expect(screen.queryByText('放弃本次起草？')).toBeNull();
  });

  it('显示已保存草稿的保存日期', async () => {
    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      updatedAt: '2026-07-24T06:30:00.000Z',
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'start',
            type: 'start',
            name: '开始',
            position: { x: 0, y: 0 },
            entryBehavior: 'product_viewed',
          },
        ],
        edges: [],
      },
    });
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });

    expect(screen.getByRole('status').textContent).toBe('草稿已保存 · 2026年7月24日 14:30');
  });

  it('直接删除节点及关联连线，并可撤销恢复', async () => {
    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'start',
            type: 'start',
            name: '开始',
            position: { x: 0, y: 0 },
            entryBehavior: 'product_viewed',
          },
          { id: 'end', type: 'end', name: '结束', position: { x: 0, y: 160 }, note: null },
        ],
        edges: [{ id: 'start-end', source: 'start', target: 'end' }],
      },
    });
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });

    fireEvent.click(screen.getByLabelText('结束：结束'));
    fireEvent.click(screen.getByRole('button', { name: '删除步骤及相关连线' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('结束：结束')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(await screen.findByLabelText('结束：结束')).toBeTruthy();
  });

  // 用完整的 d3 鼠标事件链验证拖动后的排列、撤销、重做与保存。
  it.each([
    { label: '单个', movedIds: ['wait'] },
    { label: '多个', movedIds: ['wait', 'end'] },
  ])(
    '拖动$label节点后自动排列，撤销和重做保留完整草稿及对应位置',
    async ({ movedIds }) => {
      const definition: JourneyDraftDefinition = {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'start',
            type: 'start',
            name: '开始',
            position: { x: 0, y: 0 },
            entryBehavior: 'product_viewed',
          },
          {
            id: 'wait',
            type: 'wait',
            name: '等待一分钟',
            position: { x: 0, y: 200 },
            waitSeconds: 60,
          },
          {
            id: 'end',
            type: 'end',
            name: '结束',
            position: { x: 0, y: 400 },
            note: '完成触达',
          },
        ],
        edges: [
          { id: 'start-wait', source: 'start', target: 'wait' },
          { id: 'wait-end', source: 'wait', target: 'end' },
        ],
      };
      vi.mocked(getJourney).mockResolvedValue({ ...journey, draftDefinition: definition });
      vi.mocked(saveJourneyDraft).mockImplementation(async (_id, input) => ({
        ...journey,
        revision: 2,
        draftDefinition: input.draftDefinition,
      }));
      renderEditor();
      await screen.findByLabelText('定时等待：等待一分钟');

      // 工具栏不会随画布编辑卸载，复用按钮以避免每一步都遍历整页计算可访问名称。
      const arrangeButton = screen.getByRole('button', { name: /自动排列/ });
      const undoButton = screen.getByRole('button', { name: '撤销' });
      const redoButton = screen.getByRole('button', { name: '重做' });
      const saveButton = screen.getByRole('button', { name: '保存编排' });
      const positions = () =>
        definition.nodes.map(({ id }) => screen.getByTestId(`rf__node-${id}`).style.transform);
      const initialPositions = positions();
      fireEvent.keyDown(window, { key: 'Control', code: 'ControlLeft' });
      for (const nodeId of movedIds) fireEvent.click(screen.getByTestId(`rf__node-${nodeId}`));
      fireEvent.keyUp(window, { key: 'Control', code: 'ControlLeft' });

      const draggedNode = screen.getByTestId('rf__node-wait');
      const dragMouse = (
        target: HTMLElement | Window,
        type: string,
        clientX: number,
        clientY: number,
      ) => {
        const event = new MouseEvent(type, { bubbles: true, clientX, clientY, buttons: 1 });
        // d3 需要事件所属窗口；直接赋值避开 jsdom 对 Vitest 窗口代理的构造校验。
        Object.defineProperty(event, 'view', { value: window });
        fireEvent(target, event);
      };
      dragMouse(draggedNode, 'mousedown', 100, 100);
      dragMouse(window, 'mousemove', 110, 110);
      dragMouse(window, 'mousemove', 210, 150);
      dragMouse(window, 'mouseup', 210, 150);

      const movedPositions = positions();
      expect(movedPositions[0]).toBe(initialPositions[0]);
      for (const nodeId of movedIds) {
        const index = definition.nodes.findIndex(({ id }) => id === nodeId);
        expect(movedPositions[index]).not.toBe(initialPositions[index]);
      }

      // d3 会在拖动结束的当前事件循环内屏蔽点击，等待它解除后再点击工具栏。
      await new Promise((resolve) => setTimeout(resolve, 0));
      fireEvent.click(arrangeButton);
      fireEvent.click(await screen.findByRole('button', { name: '自动排列' }));
      const arrangedPositions = positions();
      expect(arrangedPositions).not.toEqual(movedPositions);

      fireEvent.click(undoButton);
      expect(positions()).toEqual(movedPositions);
      expect(screen.queryByLabelText('流程检查')).toBeNull();
      fireEvent.click(undoButton);
      expect(positions()).toEqual(initialPositions);
      expect(undoButton.hasAttribute('disabled')).toBe(true);
      fireEvent.click(redoButton);
      expect(positions()).toEqual(movedPositions);
      fireEvent.click(redoButton);
      expect(positions()).toEqual(arrangedPositions);
      fireEvent.click(undoButton);
      fireEvent.click(saveButton);

      await waitFor(() => expect(saveJourneyDraft).toHaveBeenCalledTimes(1));
      const saved = vi.mocked(saveJourneyDraft).mock.calls[0]![1].draftDefinition;
      expect(saved.edges).toEqual(definition.edges);
      expect(saved.nodes).toEqual(
        definition.nodes.map((node) => ({ ...node, position: expect.any(Object) })),
      );
    },
    15_000,
  );

  it('在流程检查卡片中显示问题并通过定位选中相关步骤', async () => {
    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'start',
            type: 'start',
            name: '开始',
            position: { x: 0, y: 0 },
            entryBehavior: 'product_viewed',
          },
          {
            id: 'condition',
            type: 'condition',
            name: '高价值用户',
            position: { x: 0, y: 160 },
            rules: {
              kind: 'compare',
              left: { source: 'user', path: 'vipLevel' },
              operator: 'in',
              right: ['gold', 'platinum'],
            },
          },
          { id: 'end', type: 'end', name: '结束', position: { x: 0, y: 320 }, note: null },
        ],
        edges: [
          { id: 'start-condition', source: 'start', target: 'condition' },
          { id: 'condition-end', source: 'condition', target: 'end', branch: 'met' },
        ],
      },
    });
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });

    expect(await screen.findByLabelText('流程检查')).toBeTruthy();
    // 页签按钮、页签面板和侧栏都带“步骤设置”这个名字，这里只取侧栏本身。
    const inspector = screen.getByRole('complementary', { name: '步骤设置' });
    const flowCheck = screen.getByLabelText('流程检查');
    expect(
      inspector.compareDocumentPosition(flowCheck) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText('1 个问题')).toBeTruthy();
    expect(screen.getByText(/高价值用户.*不满足.*路径还没有连接/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '定位' }));
    expect(await screen.findByLabelText('节点名称')).toBeTruthy();
  });

  it('支持撤销、重做、复制和粘贴，不提供键盘连线入口', async () => {
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    const editor = screen.getByLabelText('旅程编排');

    expect(screen.queryByRole('button', { name: '键盘连接' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '添加开始旅程' }));
    fireEvent.click(screen.getByRole('button', { name: '添加结束旅程' }));
    await waitFor(() => {
      expect(screen.getByLabelText('开始：开始')).toBeTruthy();
      expect(screen.getByLabelText('结束：结束')).toBeTruthy();
    });

    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByLabelText('开始：开始')).toBeTruthy();
      expect(screen.queryByLabelText('结束：结束')).toBeNull();
    });
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(await screen.findByLabelText('结束：结束')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('结束：结束'));
    fireEvent.click(screen.getByRole('button', { name: /复制/ }));
    fireEvent.keyDown(editor, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(screen.getAllByLabelText('结束：结束')).toHaveLength(2));
  });

  it('撤销重做快捷键不依赖页面空白、工具栏按钮或节点焦点', async () => {
    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'existing-end',
            type: 'end',
            name: '保留节点',
            position: { x: 0, y: 0 },
            note: null,
          },
          {
            id: 'unfinished-message',
            type: 'message',
            name: '未完成消息',
            position: { x: 320, y: 0 },
            channel: 'sms',
            subject: null,
            body: '',
          },
        ],
        edges: [],
      },
    });
    renderEditor();
    await screen.findByLabelText('结束：保留节点');
    fireEvent.click(screen.getByRole('button', { name: '添加结束旅程' }));
    await screen.findByLabelText('结束：结束');

    const body = document.body;
    const oldTabIndex = body.getAttribute('tabindex');
    body.tabIndex = 0;
    try {
      let event = dispatchShortcut(body, 'z', { ctrlKey: true });
      expect(event.defaultPrevented).toBe(true);
      await waitFor(() => expect(screen.queryByLabelText('结束：结束')).toBeNull());

      event = dispatchShortcut(body, 'z', { metaKey: true, shiftKey: true });
      expect(event.defaultPrevented).toBe(true);
      await screen.findByLabelText('结束：结束');

      const undoButton = screen.getByRole('button', { name: '撤销' });
      event = dispatchShortcut(undoButton, 'z', { metaKey: true });
      expect(event.defaultPrevented).toBe(true);
      await waitFor(() => expect(screen.queryByLabelText('结束：结束')).toBeNull());

      const redoButton = screen.getByRole('button', { name: '重做' });
      event = dispatchShortcut(redoButton, 'z', { ctrlKey: true, shiftKey: true });
      expect(event.defaultPrevented).toBe(true);
      await screen.findByLabelText('结束：结束');

      event = dispatchShortcut(screen.getByTestId('rf__node-existing-end'), 'z', {
        ctrlKey: true,
      });
      expect(event.defaultPrevented).toBe(true);
      await waitFor(() => expect(screen.queryByLabelText('结束：结束')).toBeNull());

      event = dispatchShortcut(screen.getByTestId('rf__node-existing-end'), 'y', {
        ctrlKey: true,
      });
      expect(event.defaultPrevented).toBe(true);
      await screen.findByLabelText('结束：结束');

      event = dispatchShortcut(body, 'c', { ctrlKey: true });
      expect(event.defaultPrevented).toBe(false);
      event = dispatchShortcut(body, 'v', { ctrlKey: true });
      expect(event.defaultPrevented).toBe(false);
      event = dispatchShortcut(body, 'Delete');
      expect(event.defaultPrevented).toBe(false);
      expect(screen.getAllByLabelText('结束：结束')).toHaveLength(1);
    } finally {
      if (oldTabIndex === null) body.removeAttribute('tabindex');
      else body.setAttribute('tabindex', oldTabIndex);
    }
  });

  it('复制内容在取消选择后仍可从页面、按钮和节点焦点粘贴一次', async () => {
    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'source-end',
            type: 'end',
            name: '源节点',
            position: { x: 0, y: 0 },
            note: null,
          },
          {
            id: 'unfinished-message',
            type: 'message',
            name: '未完成消息',
            position: { x: 320, y: 0 },
            channel: 'sms',
            subject: null,
            body: '',
          },
        ],
        edges: [],
      },
    });
    const { container } = renderEditor();
    const sourceNode = await screen.findByLabelText('结束：源节点');
    fireEvent.click(sourceNode);
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '复制' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );

    expect(
      dispatchShortcut(screen.getByTestId('rf__node-source-end'), 'c', { ctrlKey: true })
        .defaultPrevented,
    ).toBe(true);
    expect(
      dispatchShortcut(screen.getByRole('button', { name: '复制' }), 'c', { metaKey: true })
        .defaultPrevented,
    ).toBe(true);
    const pane = container.querySelector('.react-flow__pane');
    expect(pane).not.toBeNull();
    fireEvent.click(pane!);
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '复制' }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );

    const body = document.body;
    const oldTabIndex = body.getAttribute('tabindex');
    body.tabIndex = 0;
    try {
      expect(dispatchShortcut(body, 'c', { metaKey: true }).defaultPrevented).toBe(false);

      const selectedText = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue({ toString: () => '旅程画布' } as Selection);
      try {
        expect(dispatchShortcut(body, 'c', { ctrlKey: true }).defaultPrevented).toBe(false);
      } finally {
        selectedText.mockRestore();
      }

      expect(dispatchShortcut(body, 'v', { ctrlKey: true }).defaultPrevented).toBe(true);
      await waitFor(() => expect(screen.getAllByLabelText('结束：源节点')).toHaveLength(2));
      expect(dispatchShortcut(body, 'v', { metaKey: true }).defaultPrevented).toBe(true);
      await waitFor(() => expect(screen.getAllByLabelText('结束：源节点')).toHaveLength(3));

      const undoButton = screen.getByRole('button', { name: '撤销' });
      expect(dispatchShortcut(undoButton, 'v', { ctrlKey: true }).defaultPrevented).toBe(true);
      await waitFor(() => expect(screen.getAllByLabelText('结束：源节点')).toHaveLength(4));

      expect(
        dispatchShortcut(screen.getByTestId('rf__node-source-end'), 'v', { metaKey: true })
          .defaultPrevented,
      ).toBe(true);
      await waitFor(() => expect(screen.getAllByLabelText('结束：源节点')).toHaveLength(5));

      fireEvent.click(screen.getByTestId('rf__node-source-end'));
      const nameInput = (await screen.findByLabelText('节点名称')) as HTMLInputElement;
      expect(dispatchShortcut(nameInput, 'c', { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(dispatchShortcut(nameInput, 'v', { metaKey: true }).defaultPrevented).toBe(false);

      fireEvent.click(screen.getByLabelText('消息：未完成消息'));
      const messageInput = (await screen.findByLabelText('消息内容')) as HTMLTextAreaElement;
      expect(dispatchShortcut(messageInput, 'c', { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(dispatchShortcut(messageInput, 'v', { metaKey: true }).defaultPrevented).toBe(false);

      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      editable.tabIndex = 0;
      Object.defineProperty(editable, 'isContentEditable', { value: true });
      document.body.append(editable);
      try {
        expect(dispatchShortcut(editable, 'c', { metaKey: true }).defaultPrevented).toBe(false);
        expect(dispatchShortcut(editable, 'v', { ctrlKey: true }).defaultPrevented).toBe(false);
      } finally {
        editable.remove();
      }
      expect(screen.getAllByLabelText('结束：源节点')).toHaveLength(5);
    } finally {
      if (oldTabIndex === null) body.removeAttribute('tabindex');
      else body.setAttribute('tabindex', oldTabIndex);
    }
  });

  it('输入框、文本域和可编辑区域的撤销不会消耗画布历史', async () => {
    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'existing-end',
            type: 'end',
            name: '保留节点',
            position: { x: 0, y: 0 },
            note: null,
          },
          {
            id: 'unfinished-message',
            type: 'message',
            name: '未完成消息',
            position: { x: 320, y: 0 },
            channel: 'sms',
            subject: null,
            body: '',
          },
        ],
        edges: [],
      },
    });
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: '添加结束旅程' }));
    const newEnd = await screen.findByLabelText('结束：结束');
    fireEvent.click(newEnd);

    const nameInput = (await screen.findByLabelText('节点名称')) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '编辑中的名称' } });
    let event = dispatchShortcut(nameInput, 'z', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByLabelText('结束：编辑中的名称')).toBeTruthy();
    expect(screen.getByLabelText('结束：保留节点')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('消息：未完成消息'));
    const messageInput = (await screen.findByLabelText('消息内容')) as HTMLTextAreaElement;
    fireEvent.change(messageInput, { target: { value: '正在编辑的正文' } });
    event = dispatchShortcut(messageInput, 'z', { metaKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByLabelText('结束：编辑中的名称')).toBeTruthy();

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    editable.tabIndex = 0;
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.append(editable);
    try {
      event = dispatchShortcut(editable, 'z', { ctrlKey: true });
      expect(event.defaultPrevented).toBe(false);
      expect(screen.getByLabelText('结束：编辑中的名称')).toBeTruthy();
    } finally {
      editable.remove();
    }
  });

  it('配置错误时仍可粘贴，配置问题与结构提示同时显示且保存被阻止', async () => {
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    const editor = screen.getByLabelText('旅程编排');

    fireEvent.click(screen.getByRole('button', { name: '添加消息' }));
    fireEvent.click(screen.getByRole('button', { name: '添加条件分支' }));
    fireEvent.click(screen.getByLabelText('消息：消息'));
    fireEvent.click(screen.getByRole('button', { name: /复制/ }));
    fireEvent.keyDown(editor, { key: 'v', ctrlKey: true });

    await waitFor(() => expect(screen.getAllByLabelText('消息：消息')).toHaveLength(2));
    // 两个节点的流程检查各一条，选中节点的设置面板再就地提示一条。
    expect(screen.getAllByText('消息内容不能为空')).toHaveLength(3);
    expect(screen.getByText('请填写比较值')).toBeTruthy();
    expect(screen.getByText('旅程还没有结束节点。')).toBeTruthy();
    expect((screen.getByRole('button', { name: '保存编排' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '保存编排' }));
    expect(saveJourneyDraft).not.toHaveBeenCalled();
  });

  it('切换等待单位保留当前整数，并按新单位重新计算时长', async () => {
    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'wait',
            type: 'wait',
            name: '等待一步',
            position: { x: 0, y: 0 },
            waitSeconds: 3_600,
          },
        ],
        edges: [],
      },
    });
    renderEditor();
    fireEvent.click(await screen.findByLabelText('定时等待：等待一步'));

    const durationInput = screen.getByLabelText('等待时长数值') as HTMLInputElement;
    expect(durationInput.value).toBe('1');
    const unitSelect = screen.getByLabelText('等待时长单位');
    fireEvent.mouseDown(unitSelect);
    fireEvent.click(screen.getByText('天'));
    expect(durationInput.value).toBe('1');
    expect(screen.getByText('等待设置：1 天')).toBeTruthy();

    fireEvent.change(durationInput, { target: { value: '24' } });
    fireEvent.blur(durationInput);
    fireEvent.mouseDown(unitSelect);
    fireEvent.click(screen.getByText('小时'));
    expect(durationInput.value).toBe('24');
    expect(screen.getByText('等待设置：1 天')).toBeTruthy();
  });

  it('超限等待输入不截断，并阻止手动和自动保存', async () => {
    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'wait',
            type: 'wait',
            name: '等待一步',
            position: { x: 0, y: 0 },
            waitSeconds: 3_600,
          },
        ],
        edges: [],
      },
    });
    renderEditor();
    fireEvent.click(await screen.findByLabelText('定时等待：等待一步'));

    const durationInput = screen.getByLabelText('等待时长数值') as HTMLInputElement;
    fireEvent.mouseDown(screen.getByLabelText('等待时长单位'));
    fireEvent.click(screen.getByText('天'));
    fireEvent.change(durationInput, { target: { value: '31' } });
    fireEvent.blur(durationInput);

    // 设置面板就地提示，流程检查保留同一条错误做全局兜底。
    expect(
      await within(screen.getByRole('tabpanel', { name: '步骤设置' })).findByText(
        '等待时长最多 30 天',
      ),
    );
    expect(durationInput.closest('.ant-input-number')?.className).toContain(
      'ant-input-number-status-error',
    );
    expect(
      within(screen.getByRole('region', { name: '流程检查' })).getByText('等待时长最多 30 天'),
    ).toBeTruthy();
    expect(durationInput.value).toBe('31');
    expect((screen.getByRole('button', { name: '保存编排' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '保存编排' }));

    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(saveJourneyDraft).not.toHaveBeenCalled();
  });

  it('条件节点只配置一条比较判断并保存为单个比较规则', async () => {
    vi.mocked(saveJourneyDraft).mockImplementation(async (_id, input) => ({
      ...journey,
      revision: 2,
      updatedAt: '2026-07-24T06:30:00.000Z',
      draftDefinition: input.draftDefinition,
    }));
    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'start',
            type: 'start',
            name: '开始',
            position: { x: 0, y: 0 },
            entryBehavior: 'product_viewed',
          },
          {
            id: 'condition',
            type: 'condition',
            name: '高价值用户',
            position: { x: 0, y: 160 },
            rules: {
              kind: 'compare',
              left: { source: 'user', path: 'displayName' },
              operator: 'eq',
            },
          },
          { id: 'end', type: 'end', name: '结束', position: { x: 0, y: 320 }, note: null },
        ],
        edges: [
          { id: 'start-condition', source: 'start', target: 'condition' },
          { id: 'condition-end', source: 'condition', target: 'end', branch: 'met' },
        ],
      },
    });
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    fireEvent.click(screen.getByLabelText('条件分支：高价值用户'));

    expect(await screen.findByLabelText('条件用户属性')).toBeTruthy();
    expect(screen.getByLabelText('条件比较方式')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '添加条件' })).toBeNull();
    expect(screen.queryByRole('button', { name: '添加条件组' })).toBeNull();
    expect(screen.queryByRole('button', { name: '添加排除组' })).toBeNull();
    expect(screen.queryByRole('radio', { name: '任一满足' })).toBeNull();

    fireEvent.change(screen.getByLabelText('条件比较值'), { target: { value: '会员A' } });
    fireEvent.click(screen.getByRole('button', { name: '保存编排' }));

    await waitFor(() => expect(saveJourneyDraft).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveJourneyDraft).mock.calls[0]?.[1].draftDefinition.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'condition',
          rules: {
            kind: 'compare',
            left: { source: 'user', path: 'displayName' },
            operator: 'eq',
            right: '会员A',
          },
        }),
      ]),
    );
  });

  it('切换消息渠道时清空正文和主题', async () => {
    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'message',
            type: 'message',
            name: '欢迎消息',
            position: { x: 0, y: 0 },
            channel: 'sms',
            subject: null,
            body: '旧内容',
          },
        ],
        edges: [],
      },
    });
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    fireEvent.click(screen.getByLabelText('消息：欢迎消息'));

    fireEvent.mouseDown(screen.getByLabelText('消息渠道'));
    fireEvent.click(await screen.findByTitle('邮件'));

    expect((screen.getByLabelText('消息内容') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText('邮件主题') as HTMLInputElement).value).toBe('');
  });

  it('停止编辑后自动保存并显示已自动保存', async () => {
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });

    fireEvent.click(screen.getByRole('button', { name: '添加结束旅程' }));
    await waitFor(() => expect(saveJourneyDraft).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('已自动保存 · 2026年7月24日 14:30'),
    );
  });

  it('自动保存请求期间仍可编辑，且不会并发发送第二个请求', async () => {
    const pendingSaves: Array<{
      input: { revision: number; draftDefinition: JourneyDraftDefinition };
      resolve: (value: JourneyDetail) => void;
    }> = [];
    vi.mocked(saveJourneyDraft).mockImplementation(
      (_id, input) =>
        new Promise<JourneyDetail>((resolve) => {
          pendingSaves.push({ input, resolve });
        }),
    );
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });

    fireEvent.click(screen.getByRole('button', { name: '添加结束旅程' }));
    await waitFor(() => expect(saveJourneyDraft).toHaveBeenCalledTimes(1), { timeout: 3000 });

    fireEvent.click(screen.getByLabelText('结束：结束'));
    const nameInput = await screen.findByLabelText('节点名称');
    expect((nameInput as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(nameInput, { target: { value: '新的结束' } });

    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(saveJourneyDraft).toHaveBeenCalledTimes(1);

    const firstSave = pendingSaves[0]!;
    firstSave.resolve({
      ...journey,
      revision: 2,
      draftDefinition: firstSave.input.draftDefinition,
    });
    // 旧请求成功只代表发起时的内容已保存，请求期间的新输入仍显示为未保存。
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('有未保存修改'));
  });

  it('自动保存失败后暂停，内容再次变化后重试', async () => {
    vi.mocked(saveJourneyDraft).mockRejectedValueOnce(new Error('network'));
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });

    fireEvent.click(screen.getByRole('button', { name: '添加结束旅程' }));
    expect(await screen.findByText('服务暂时不可用，请稍后重试')).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(saveJourneyDraft).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('结束：结束'));
    fireEvent.change(await screen.findByLabelText('节点名称'), {
      target: { value: '失败后重试' },
    });
    await waitFor(() => expect(saveJourneyDraft).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });

  it('补齐必填消息内容后保存完整草稿并更新为已保存', async () => {
    vi.mocked(saveJourneyDraft).mockImplementation(async (_id, input) => ({
      ...journey,
      revision: 2,
      updatedAt: '2026-07-24T06:30:00.000Z',
      draftDefinition: input.draftDefinition,
    }));
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });

    fireEvent.click(screen.getByRole('button', { name: '添加消息' }));
    expect(await screen.findByText('消息内容不能为空')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '定位' })[0]!);
    fireEvent.change(await screen.findByLabelText('消息内容'), {
      target: { value: '欢迎加入' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加开始旅程' }));
    fireEvent.click(screen.getByRole('button', { name: '添加结束旅程' }));
    fireEvent.click(screen.getByRole('radio', { name: '横向' }));

    const saveButton = screen.getByRole('button', { name: '保存编排' });
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton);

    await waitFor(() => expect(saveJourneyDraft).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveJourneyDraft).mock.calls[0]?.[1].draftDefinition).toMatchObject({
      layoutDirection: 'horizontal',
      nodes: expect.arrayContaining([
        expect.objectContaining({ type: 'message' }),
        expect.objectContaining({ type: 'start' }),
        expect.objectContaining({ type: 'end' }),
      ]),
    });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('草稿已保存 · 2026年7月24日 14:30'),
    );
  });

  it('保存冲突保留本地内容，确认读取最新内容后重置编辑状态并使用最新修订号保存', async () => {
    const latest: JourneyDetail = {
      ...journey,
      revision: 7,
      draftDefinition: {
        layoutDirection: 'horizontal',
        nodes: [
          {
            id: 'remote-end',
            type: 'end',
            name: '服务器的结束',
            position: { x: 80, y: 80 },
            note: null,
          },
        ],
        edges: [],
      },
    };
    vi.mocked(getJourney).mockResolvedValueOnce(journey).mockResolvedValue(latest);
    vi.mocked(saveJourneyDraft)
      .mockImplementation(async (_id, input) => ({
        ...latest,
        revision: input.revision + 1,
        draftDefinition: input.draftDefinition,
      }))
      .mockRejectedValueOnce(new ApiError(409, 'JOURNEY_REVISION_CONFLICT', '旅程已被修改'));
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    fireEvent.click(screen.getByRole('button', { name: '添加结束旅程' }));
    fireEvent.click(screen.getByLabelText('结束：结束'));
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    fireEvent.click(screen.getByRole('button', { name: '保存编排' }));

    expect(await screen.findByText(/旅程已在其他页面修改/)).toBeTruthy();
    expect(screen.getByLabelText('结束：结束')).toBeTruthy();
    expect((screen.getByRole('button', { name: '保存编排' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(await screen.findByLabelText('节点名称'), {
      target: { value: '冲突后继续修改' },
    });
    expect(await screen.findByText(/旅程已在其他页面修改/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '读取最新内容' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '保存编排' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '读取最新内容' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '继续编辑' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(getJourney).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('结束：冲突后继续修改')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '读取最新内容' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '读取最新内容' }),
    );
    await screen.findByLabelText('结束：服务器的结束');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByLabelText('结束：结束')).toBeNull();
    expect(screen.queryByLabelText('结束：冲突后继续修改')).toBeNull();
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText('节点名称')).toBeNull();
    fireEvent.keyDown(screen.getByLabelText('旅程编排'), { key: 'v', ctrlKey: true });
    expect(screen.getAllByLabelText('结束：服务器的结束')).toHaveLength(1);
    expect(screen.queryByLabelText('结束：冲突后继续修改')).toBeNull();

    fireEvent.click(screen.getByLabelText('结束：服务器的结束'));
    fireEvent.change(await screen.findByLabelText('节点名称'), {
      target: { value: '读取后继续编辑' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存编排' }));
    await waitFor(() => expect(saveJourneyDraft).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveJourneyDraft).mock.calls[1]?.[1].revision).toBe(7);
    expect(vi.mocked(saveJourneyDraft).mock.calls[1]?.[1].draftDefinition.nodes[0]?.name).toBe(
      '读取后继续编辑',
    );
  });

  it('确认弹窗获得焦点时不触发底层画布快捷键', async () => {
    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'unfinished-message',
            type: 'message',
            name: '未完成消息',
            position: { x: 320, y: 0 },
            channel: 'sms',
            subject: null,
            body: '',
          },
        ],
        edges: [],
      },
    });
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    fireEvent.click(screen.getByRole('button', { name: '添加结束旅程' }));
    const endNode = await screen.findByLabelText('结束：结束');
    fireEvent.click(endNode);
    expect(
      dispatchShortcut(endNode.closest<HTMLElement>('[data-testid^="rf__node-"]')!, 'c', {
        ctrlKey: true,
      }).defaultPrevented,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /返回活动/ }));

    const dialog = await screen.findByRole('dialog', { name: '放弃未保存的修改？' });
    const continueButton = within(dialog).getByRole('button', { name: '继续编辑' });
    const event = dispatchShortcut(continueButton, 'z', { ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(dispatchShortcut(continueButton, 'c', { metaKey: true }).defaultPrevented).toBe(false);
    expect(dispatchShortcut(continueButton, 'v', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(screen.getByLabelText('结束：结束')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: '放弃未保存的修改？' })).toBeTruthy();

    const body = document.body;
    const oldTabIndex = body.getAttribute('tabindex');
    body.tabIndex = 0;
    try {
      const backgroundEvent = dispatchShortcut(body, 'z', { ctrlKey: true });
      expect(backgroundEvent.defaultPrevented).toBe(false);
      expect(dispatchShortcut(body, 'v', { metaKey: true }).defaultPrevented).toBe(false);
      expect(screen.getByLabelText('结束：结束')).toBeTruthy();
    } finally {
      if (oldTabIndex === null) body.removeAttribute('tabindex');
      else body.setAttribute('tabindex', oldTabIndex);
    }

    fireEvent.click(continueButton);
  });

  it('暂停活动下可以编排和发布，不显示只读提示', async () => {
    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      campaign: { ...journey.campaign, status: 'paused' },
    });
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });

    expect(screen.queryByText(/旅程只能查看/)).toBeNull();
    expect(screen.getByRole('button', { name: '保存编排' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '发布版本' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '添加结束旅程' }).hasAttribute('disabled')).toBe(
      false,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加结束旅程' }));
    expect(await screen.findByLabelText('结束：结束')).toBeTruthy();
  });

  it('只读活动不能复制、粘贴或修改画布', async () => {
    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      campaign: { ...journey.campaign, status: 'running' },
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [{ id: 'end', type: 'end', name: '结束', position: { x: 0, y: 0 }, note: null }],
        edges: [],
      },
    });
    renderEditor();
    const endNode = await screen.findByLabelText('结束：结束');
    fireEvent.click(endNode);
    expect((screen.getByLabelText('节点名称') as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: '添加结束旅程' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: '删除步骤及相关连线' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole('button', { name: '保存编排' })).toBeNull();
    expect((screen.getByRole('button', { name: '复制' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/只读：可以查看画布/)).toBeDefined();

    // 只读时不再接管复制、粘贴等快捷键，交回浏览器默认行为。
    const copy = dispatchShortcut(
      endNode.closest<HTMLElement>('[data-testid^="rf__node-"]')!,
      'c',
      { ctrlKey: true },
    );
    expect(copy.defaultPrevented).toBe(false);
    const body = document.body;
    const oldTabIndex = body.getAttribute('tabindex');
    body.tabIndex = 0;
    try {
      const paste = dispatchShortcut(body, 'v', { metaKey: true });
      expect(paste.defaultPrevented).toBe(false);
      fireEvent.keyDown(screen.getByLabelText('旅程编排'), { key: 'Delete' });
      fireEvent.keyDown(screen.getByLabelText('旅程编排'), { key: 'z', ctrlKey: true });
      expect(screen.getAllByLabelText('结束：结束')).toHaveLength(1);
      expect(saveJourneyDraft).not.toHaveBeenCalled();

      const undo = dispatchShortcut(body, 'z', { ctrlKey: true });
      const redo = dispatchShortcut(body, 'y', { ctrlKey: true });
      expect(undo.defaultPrevented).toBe(false);
      expect(redo.defaultPrevented).toBe(false);
      expect(screen.getAllByLabelText('结束：结束')).toHaveLength(1);
    } finally {
      if (oldTabIndex === null) body.removeAttribute('tabindex');
      else body.setAttribute('tabindex', oldTabIndex);
    }
  });

  it('离开编排页后移除画布快捷键监听', async () => {
    vi.mocked(getJourney).mockResolvedValueOnce({
      ...journey,
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [
          { id: 'end', type: 'end', name: '结束', position: { x: 0, y: 0 }, note: null },
          {
            id: 'unfinished-message',
            type: 'message',
            name: '未完成消息',
            position: { x: 320, y: 0 },
            channel: 'sms',
            subject: null,
            body: '',
          },
        ],
        edges: [],
      },
    });
    const { router } = renderEditor();
    const endNode = await screen.findByLabelText('结束：结束');
    fireEvent.click(endNode);
    expect(
      dispatchShortcut(endNode.closest<HTMLElement>('[data-testid^="rf__node-"]')!, 'c', {
        ctrlKey: true,
      }).defaultPrevented,
    ).toBe(true);
    await act(async () => {
      await router.navigate(`/campaigns/${journey.campaign.id}`);
    });
    expect(await screen.findByText('活动详情')).toBeTruthy();

    const body = document.body;
    const oldTabIndex = body.getAttribute('tabindex');
    body.tabIndex = 0;
    try {
      const undo = dispatchShortcut(body, 'z', { ctrlKey: true });
      const redo = dispatchShortcut(body, 'y', { metaKey: true });
      const copy = dispatchShortcut(body, 'c', { ctrlKey: true });
      const paste = dispatchShortcut(body, 'v', { metaKey: true });
      expect(undo.defaultPrevented).toBe(false);
      expect(redo.defaultPrevented).toBe(false);
      expect(copy.defaultPrevented).toBe(false);
      expect(paste.defaultPrevented).toBe(false);
    } finally {
      if (oldTabIndex === null) body.removeAttribute('tabindex');
      else body.setAttribute('tabindex', oldTabIndex);
    }
  });

  it('修改节点配置后仍提示未保存并阻止刷新，但不产生画布撤销记录', async () => {
    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [{ id: 'end', type: 'end', name: '结束', position: { x: 0, y: 0 }, note: null }],
        edges: [],
      },
    });
    renderEditor();
    await screen.findByLabelText('结束：结束');
    fireEvent.click(screen.getByLabelText('结束：结束'));
    fireEvent.change(await screen.findByLabelText('节点名称'), {
      target: { value: '新的结束' },
    });

    expect(screen.getByRole('status').textContent).toBe('有未保存修改');
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true);
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
  });

  it('未保存的无效草稿阻止刷新和离开，取消后保留内容，确认后返回活动', async () => {
    const { router } = renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    fireEvent.click(screen.getByRole('button', { name: '添加消息' }));
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /返回活动/ }));
    expect(await screen.findByRole('dialog', { name: '放弃未保存的修改？' })).toBeTruthy();
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '继续编辑' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.pathname).toBe(`/journeys/${journeyId}/editor`);
    expect(screen.getByLabelText('消息：消息')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /返回活动/ }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '放弃修改' }),
    );
    expect(await screen.findByText('活动详情')).toBeTruthy();
    expect(saveJourneyDraft).not.toHaveBeenCalled();
  });

  it('从编排切换到已发布版本会卸载编辑器，仍要求确认未保存修改', async () => {
    const { router } = renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    fireEvent.click(screen.getByRole('button', { name: '添加消息' }));

    let navigation: Promise<void> | undefined;
    await act(async () => {
      navigation = router.navigate(
        `/journeys/${journeyId}/versions/5c1e5c1a-9d0c-4d9c-8e5a-3f1e2d4c6b70`,
      );
    });

    expect(await screen.findByRole('dialog', { name: '放弃未保存的修改？' })).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/journeys/${journeyId}/editor`);

    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '继续编辑' }),
    );
    await act(async () => {
      await navigation;
    });
    expect(router.state.location.pathname).toBe(`/journeys/${journeyId}/editor`);
    expect(screen.getByLabelText('消息：消息')).toBeTruthy();
  });

  it('从编排进入旅程详情页会先确认未保存修改，确认后才离开', async () => {
    const { router } = renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    fireEvent.click(screen.getByRole('button', { name: '添加消息' }));

    let navigation: Promise<void> | undefined;
    await act(async () => {
      navigation = router.navigate(`/journeys/${journeyId}`);
    });

    expect(await screen.findByRole('dialog', { name: '放弃未保存的修改？' })).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/journeys/${journeyId}/editor`);

    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '放弃修改' }),
    );
    await act(async () => {
      await navigation;
    });
    expect(await screen.findByText('旅程详情')).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/journeys/${journeyId}`);
  });

  it('切换旅程后忽略旧保存响应，新旅程仍使用自己的内容和修订号', async () => {
    const otherId = 'a46a907c-f0e8-477d-af76-7f71e2d77951';
    const other: JourneyDetail = {
      ...journey,
      id: otherId,
      name: '另一条旅程',
      revision: 9,
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'other-end',
            type: 'end',
            name: '另一条的结束',
            position: { x: 0, y: 0 },
            note: null,
          },
        ],
        edges: [],
      },
    };
    vi.mocked(getJourney).mockImplementation(async (id) => (id === otherId ? other : journey));
    let finishOldSave!: () => void;
    vi.mocked(saveJourneyDraft)
      .mockImplementation(async (_id, input) => ({
        ...other,
        revision: input.revision + 1,
        draftDefinition: input.draftDefinition,
      }))
      .mockImplementationOnce(
        (_id, input) =>
          new Promise<JourneyDetail>((resolve) => {
            finishOldSave = () =>
              resolve({ ...journey, revision: 2, draftDefinition: input.draftDefinition });
          }),
      );
    const { router } = renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    fireEvent.click(screen.getByRole('button', { name: '添加结束旅程' }));
    fireEvent.click(screen.getByRole('button', { name: '保存编排' }));
    await waitFor(() => expect(saveJourneyDraft).toHaveBeenCalledTimes(1));

    await act(async () => {
      await router.navigate(`/journeys/${otherId}/editor`);
    });
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '放弃修改' }),
    );
    await screen.findByRole('heading', { name: '另一条旅程' });
    await screen.findByLabelText('结束：另一条的结束');
    await act(async () => {
      finishOldSave();
    });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('草稿已保存'));
    expect(
      queryClient?.getQueryData<JourneyDetail>(journeyQueryKeys.detail(journeyId))?.revision,
    ).toBe(1);
    expect(
      queryClient?.getQueryData<JourneyDetail>(journeyQueryKeys.detail(otherId))?.revision,
    ).toBe(9);
    expect(screen.queryByLabelText('结束：结束')).toBeNull();

    fireEvent.click(screen.getByLabelText('结束：另一条的结束'));
    fireEvent.change(await screen.findByLabelText('节点名称'), {
      target: { value: '另一条的新名称' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存编排' }));
    await waitFor(() => expect(saveJourneyDraft).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveJourneyDraft).mock.calls[1]?.[0]).toBe(otherId);
    expect(vi.mocked(saveJourneyDraft).mock.calls[1]?.[1].revision).toBe(9);
  });

  it('从 A 确认切换到 B 只放行这次跳转，B 的未保存修改仍阻止离开', async () => {
    const otherId = 'a46a907c-f0e8-477d-af76-7f71e2d77951';
    const other: JourneyDetail = {
      ...journey,
      id: otherId,
      name: '另一条旅程',
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'other-end',
            type: 'end',
            name: '另一条的结束',
            position: { x: 0, y: 0 },
            note: null,
          },
        ],
        edges: [],
      },
    };
    vi.mocked(getJourney).mockImplementation(async (id) => (id === otherId ? other : journey));
    const { router } = renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });
    fireEvent.click(screen.getByRole('button', { name: '添加消息' }));

    await act(async () => {
      await router.navigate(`/journeys/${otherId}/editor`);
    });
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '放弃修改' }),
    );
    await screen.findByRole('heading', { name: '另一条旅程' });
    fireEvent.click(screen.getByLabelText('结束：另一条的结束'));
    fireEvent.change(await screen.findByLabelText('节点名称'), { target: { value: '' } });

    await act(async () => {
      await router.navigate(`/campaigns/${journey.campaign.id}`);
    });

    expect(await screen.findByRole('dialog', { name: '放弃未保存的修改？' })).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/journeys/${otherId}/editor`);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toBe('有未保存修改');
  });

  it('在独立模拟页运行当前示例资料，定位结果步骤并留在模拟页', async () => {
    const draftDefinition: JourneyDraftDefinition = {
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
          name: '消息',
          position: { x: 0, y: 120 },
          channel: 'sms',
          subject: null,
          body: '欢迎',
        },
        { id: 'n-end', type: 'end', name: '结束', position: { x: 0, y: 240 }, note: null },
      ],
      edges: [
        { id: 'e1', source: 'n-start', target: 'n-message' },
        { id: 'e2', source: 'n-message', target: 'n-end' },
      ],
    };
    vi.mocked(getJourney).mockResolvedValue({ ...journey, draftDefinition });
    const result: JourneySimulationResult = {
      outcome: 'completed',
      user: { displayName: '张三' },
      admission: {
        entryBehavior: {
          expected: 'app_session_started',
          actual: 'app_session_started',
          matched: true,
        },
        segment: null,
      },
      steps: [
        {
          order: 1,
          nodeId: 'n-start',
          nodeName: '开始',
          nodeType: 'start',
          elapsedSeconds: 0,
          entryBehavior: 'app_session_started',
        },
        {
          order: 2,
          nodeId: 'n-message',
          nodeName: '消息',
          nodeType: 'message',
          elapsedSeconds: 0,
          channel: 'sms',
          subject: null,
          body: '欢迎',
        },
        {
          order: 3,
          nodeId: 'n-end',
          nodeName: '结束',
          nodeType: 'end',
          elapsedSeconds: 0,
          note: null,
        },
      ],
      traversedEdgeIds: ['e1', 'e2'],
      elapsedSeconds: 0,
    };
    vi.mocked(simulateJourney).mockResolvedValue(result);

    const { router } = renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });

    fireEvent.click(screen.getByRole('button', { name: '打开旅程模拟' }));
    expect(await screen.findByRole('region', { name: '旅程模拟' })).toBeTruthy();
    expect(screen.getByRole('main', { name: '旅程画布' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '开始模拟' }));

    expect(await screen.findByText('已走过 1 步 · 每步间隔 0.5 秒')).toBeTruthy();
    expect(document.querySelectorAll('[data-simulation-state="traversed"]')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '定位' })).toHaveLength(1);
    expect(screen.queryByText('已到达结束步骤')).toBeNull();
    expect(screen.queryByText('本次模拟已完成')).toBeNull();
    await waitFor(
      () =>
        expect(document.querySelectorAll('[data-simulation-state="traversed"]')).toHaveLength(2),
      { timeout: 1800 },
    );
    expect(screen.getAllByRole('button', { name: '定位' })).toHaveLength(2);
    expect(await screen.findByText('已到达结束步骤', {}, { timeout: 2000 })).toBeTruthy();
    expect(document.querySelectorAll('[data-simulation-state="traversed"]')).toHaveLength(3);

    fireEvent.click(screen.getAllByRole('button', { name: '定位' })[1]!);
    expect(router.state.location.pathname).toBe(`/journeys/${journeyId}/simulation`);
    expect(screen.getByRole('button', { name: '返回编排' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '打开旅程模拟' })).toBeNull();
    expect(
      screen.getByTestId('rf__node-n-message').querySelector('[data-selected="true"]'),
    ).not.toBeNull();

    let finish: ((value: JourneySimulationResult) => void) | undefined;
    vi.mocked(simulateJourney).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '重新模拟' }));

    expect(screen.queryByRole('region', { name: '模拟结果' })).toBeNull();
    expect(document.querySelectorAll('[data-simulation-state="traversed"]')).toHaveLength(0);
    expect(
      ((await screen.findByRole('button', { name: /模拟中…/ })) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => finish?.(result));

    expect(document.querySelectorAll('[data-simulation-state="traversed"]')).toHaveLength(1);
    expect(await screen.findByText('已到达结束步骤', {}, { timeout: 4000 })).toBeTruthy();
    expect(document.querySelectorAll('[data-simulation-state="traversed"]')).toHaveLength(3);
    expect(simulateJourney).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: '重新模拟' }));
    await screen.findByText('已走过 1 步 · 每步间隔 0.5 秒');
    fireEvent.click(screen.getByRole('button', { name: '返回编排' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开旅程模拟' }));
    expect(await screen.findByRole('button', { name: '开始模拟' })).toBeTruthy();
    expect(document.querySelectorAll('[data-simulation-state="traversed"]')).toHaveLength(0);
    expect(screen.queryByRole('region', { name: '模拟结果' })).toBeNull();
  }, 20_000);

  it('流程不完整时禁用模拟入口并提示原因，直接打开模拟地址会回到编排页', async () => {
    const { router } = renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });

    const button = screen.getByRole('button', { name: '打开旅程模拟' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.mouseEnter(button.parentElement!);
    expect((await screen.findByRole('tooltip')).textContent).toContain('节点');

    await act(async () => {
      await router.navigate(`/journeys/${journeyId}/simulation`);
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/journeys/${journeyId}/editor`),
    );
    expect(screen.getByRole('button', { name: '打开旅程模拟' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '返回编排' })).toBeNull();
  }, 20_000);

  it('修改节点配置后清除模拟结果和高亮，并提示重新模拟', async () => {
    const draftDefinition: JourneyDraftDefinition = {
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
          name: '消息',
          position: { x: 0, y: 120 },
          channel: 'sms',
          subject: null,
          body: '欢迎',
        },
        { id: 'n-end', type: 'end', name: '结束', position: { x: 0, y: 240 }, note: null },
      ],
      edges: [
        { id: 'e1', source: 'n-start', target: 'n-message' },
        { id: 'e2', source: 'n-message', target: 'n-end' },
      ],
    };
    vi.mocked(getJourney).mockResolvedValue({ ...journey, draftDefinition });
    vi.mocked(saveJourneyDraft).mockImplementation(async (_id, input) => ({
      ...journey,
      revision: 2,
      draftDefinition: input.draftDefinition,
    }));
    vi.mocked(simulateJourney).mockResolvedValue({
      outcome: 'completed',
      user: { displayName: '张三' },
      admission: {
        entryBehavior: {
          expected: 'app_session_started',
          actual: 'app_session_started',
          matched: true,
        },
        segment: null,
      },
      steps: [
        {
          order: 1,
          nodeId: 'n-start',
          nodeName: '开始',
          nodeType: 'start',
          elapsedSeconds: 0,
          entryBehavior: 'app_session_started',
        },
        {
          order: 2,
          nodeId: 'n-message',
          nodeName: '消息',
          nodeType: 'message',
          elapsedSeconds: 0,
          channel: 'sms',
          subject: null,
          body: '欢迎',
        },
        {
          order: 3,
          nodeId: 'n-end',
          nodeName: '结束',
          nodeType: 'end',
          elapsedSeconds: 0,
          note: null,
        },
      ],
      traversedEdgeIds: ['e1', 'e2'],
      elapsedSeconds: 0,
    });

    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });

    fireEvent.click(screen.getByRole('button', { name: '打开旅程模拟' }));
    fireEvent.click(screen.getByRole('button', { name: '开始模拟' }));
    expect(await screen.findByText('已到达结束步骤', {}, { timeout: 4000 })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '返回编排' }));
    expect(await screen.findByRole('tab', { name: '步骤设置' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('rf__node-n-message'));
    fireEvent.change(await screen.findByLabelText('消息内容'), { target: { value: '新的正文' } });

    fireEvent.click(screen.getByRole('button', { name: '打开旅程模拟' }));
    expect(await screen.findByText('模拟条件已变化，请重新模拟。')).toBeTruthy();
    expect(document.querySelectorAll('[data-simulation-state="traversed"]')).toHaveLength(0);
  }, 20_000);

  it('同一旅程内搜索分页不触发未保存提示，真正离开仍会拦截', async () => {
    const { router } = renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });

    // 未完成的消息节点不会自动保存，用它制造持续的未保存状态。
    fireEvent.click(screen.getByRole('button', { name: '添加消息' }));
    await screen.findByLabelText('消息：消息');
    expect(screen.getByRole('status').textContent).toBe('有未保存修改');

    const searchUrl = `/journeys/${journeyId}/editor?q=%E5%BC%A0%E4%B8%89&page=2&pageSize=20`;
    await act(async () => {
      await router.navigate(searchUrl);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.search).toBe('?q=%E5%BC%A0%E4%B8%89&page=2&pageSize=20');

    // 搜索分页之后继续编辑，离开当前旅程仍然拦截。
    fireEvent.click(screen.getByRole('button', { name: '添加消息' }));
    await waitFor(() => expect(screen.getAllByLabelText('消息：消息')).toHaveLength(2));
    await act(async () => {
      await router.navigate(`/campaigns/${journey.campaign.id}`);
    });

    expect(await screen.findByRole('dialog', { name: '放弃未保存的修改？' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toBe('有未保存修改');
  }, 20_000);

  it('缺少分支连接时模拟入口禁用并提示具体问题', async () => {
    vi.mocked(getJourney).mockResolvedValue({
      ...journey,
      draftDefinition: {
        layoutDirection: 'vertical',
        nodes: [
          {
            id: 'start',
            type: 'start',
            name: '开始',
            position: { x: 0, y: 0 },
            entryBehavior: 'product_viewed',
          },
          {
            id: 'condition',
            type: 'condition',
            name: '高价值用户',
            position: { x: 0, y: 160 },
            rules: {
              kind: 'compare',
              left: { source: 'user', path: 'vipLevel' },
              operator: 'in',
              right: ['gold', 'platinum'],
            },
          },
          { id: 'end', type: 'end', name: '结束', position: { x: 0, y: 320 }, note: null },
        ],
        edges: [
          { id: 'start-condition', source: 'start', target: 'condition' },
          { id: 'condition-end', source: 'condition', target: 'end', branch: 'met' },
        ],
      },
    });
    renderEditor();
    await screen.findByRole('heading', { name: '欢迎旅程' });

    const button = screen.getByRole('button', { name: '打开旅程模拟' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.mouseEnter(button.parentElement!);
    expect((await screen.findByRole('tooltip')).textContent).toContain('不满足');
  }, 20_000);
});
