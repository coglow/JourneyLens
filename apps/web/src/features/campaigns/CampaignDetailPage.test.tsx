import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { campaignQueryKeys } from './campaign-queries';

let mock: MockAdapter;
let queryClient: QueryClient | undefined;

const account = {
  id: 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120',
  email: 'operator@example.com',
  displayName: 'JourneyLens 管理员',
};
const campaignId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb60';
const draftCampaign = {
  id: campaignId,
  name: '春季活动',
  description: null,
  budget: null,
  status: 'draft' as const,
  createdAt: '2026-07-17T08:00:00.000Z',
  updatedAt: '2026-07-17T08:00:00.000Z',
  createdBy: { id: account.id, displayName: account.displayName },
};
const runningCampaign = {
  ...draftCampaign,
  status: 'running' as const,
  updatedAt: '2026-07-17T09:00:00.000Z',
};
const pausedCampaign = {
  ...draftCampaign,
  status: 'paused' as const,
  updatedAt: '2026-07-17T09:30:00.000Z',
};
const stoppedCampaign = {
  ...draftCampaign,
  status: 'stopped' as const,
  updatedAt: '2026-07-17T10:00:00.000Z',
};
const emptyJourneys = { data: [], page: { page: 1, pageSize: 10, total: 0 } };

function errorBody(code: string, message: string) {
  return { error: { code, message, requestId: 'test-request-id' } };
}

/** 按顺序返回多次详情：第一次读取用 replyOnce，最后一次用常驻响应。 */
function mockDetailSequence(sequence: unknown[]): void {
  sequence.forEach((data, index) => {
    const reply = mock.onGet(`/campaigns/${campaignId}`);
    if (index === sequence.length - 1) reply.reply(200, { data });
    else reply.replyOnce(200, { data });
  });
}

function renderDetail(options: { returnTo?: string } = {}) {
  mock.onGet('/userinfo').reply(200, { data: account });
  mock.onGet(/\/campaigns\/[^/]+\/journeys$/).reply(200, emptyJourneys);

  const router = createMemoryRouter(appRoutes, {
    initialEntries: [
      options.returnTo
        ? { pathname: `/campaigns/${campaignId}`, state: { returnTo: options.returnTo } }
        : `/campaigns/${campaignId}`,
    ],
  });

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

function page() {
  return screen.getByRole('region', { name: '活动详情' });
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
});

afterEach(() => {
  cleanup();
  queryClient?.clear();
  queryClient = undefined;
  mock.restore();
});

describe('活动详情启停', () => {
  it('草稿活动启动需要确认，取消不发请求，确认后进入进行中', async () => {
    mockDetailSequence([draftCampaign]);
    renderDetail();

    const startButton = await screen.findByRole('button', { name: '启动活动' });
    expect(within(page()).getByRole('button', { name: '编辑活动' })).toBeDefined();
    expect(within(page()).getByRole('button', { name: '删除活动' })).toBeDefined();
    expect(within(page()).queryByRole('button', { name: '停止活动' })).toBeNull();
    expect(screen.getByText('当前仅支持活动状态管理，暂不自动运行旅程或发送消息。')).toBeDefined();

    fireEvent.click(startButton);
    const cancelled = await screen.findByRole('dialog');
    expect(
      within(cancelled).getByText('启动后，活动资料和旅程将不能修改。未发布的内容不会应用。'),
    ).toBeDefined();
    fireEvent.click(within(cancelled).getByRole('button', { name: '暂不启动' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.history.post).toHaveLength(0);

    mock.onPost(`/campaigns/${campaignId}/start`).reply(200, { data: runningCampaign });
    fireEvent.click(within(page()).getByRole('button', { name: '启动活动' }));
    const confirmed = await screen.findByRole('dialog');
    fireEvent.click(within(confirmed).getByRole('button', { name: '启动活动' }));

    expect(await screen.findByText('活动已启动')).toBeDefined();
    expect(within(page()).getByRole('button', { name: '停止活动' })).toBeDefined();
    expect(within(page()).queryByRole('button', { name: '启动活动' })).toBeNull();
    expect(within(page()).queryByRole('button', { name: '编辑活动' })).toBeNull();
    expect(within(page()).queryByRole('button', { name: '删除活动' })).toBeNull();
    expect(mock.history.post).toHaveLength(1);
    expect(JSON.parse(mock.history.post[0]?.data as string)).toEqual({});
  });

  it('没有已发布旅程时提示先发布，活动保持草稿', async () => {
    mockDetailSequence([draftCampaign]);
    mock
      .onPost(`/campaigns/${campaignId}/start`)
      .reply(
        409,
        errorBody('CAMPAIGN_HAS_NO_PUBLISHED_JOURNEY', '请先发布至少一个旅程，再启动活动'),
      );
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '启动活动' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '启动活动' }));

    expect(await screen.findByText('请先发布至少一个旅程，再启动活动')).toBeDefined();
    expect(screen.getByRole('link', { name: '查看旅程' })).toBeDefined();
    expect(within(page()).getByRole('button', { name: '启动活动' })).toBeDefined();
    expect(screen.queryByText('活动已启动')).toBeNull();
  });

  it('状态已在别处改变时给出说明并可以刷新为真实状态', async () => {
    mockDetailSequence([draftCampaign, runningCampaign]);
    mock
      .onPost(`/campaigns/${campaignId}/start`)
      .reply(409, errorBody('CAMPAIGN_INVALID_TRANSITION', '当前活动不能启动，请刷新后查看'));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '启动活动' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '启动活动' }));

    expect(await screen.findByText('当前活动不能启动，请刷新后查看')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));

    expect(await screen.findByRole('button', { name: '停止活动' })).toBeDefined();
    expect(within(page()).queryByRole('button', { name: '启动活动' })).toBeNull();
  });

  it('进行中停止需要危险确认，停止后没有启动、编辑和删除入口', async () => {
    mockDetailSequence([runningCampaign]);
    mock.onPost(`/campaigns/${campaignId}/stop`).reply(200, { data: stoppedCampaign });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '停止活动' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('停止后不能再次启动或恢复，活动与旅程将保持只读。'),
    ).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: '停止活动' }));

    expect(await screen.findByText('活动已停止')).toBeDefined();
    expect(within(page()).queryByRole('button', { name: '启动活动' })).toBeNull();
    expect(within(page()).queryByRole('button', { name: '编辑活动' })).toBeNull();
    expect(within(page()).queryByRole('button', { name: '删除活动' })).toBeNull();
    expect(screen.queryByRole('button', { name: /新建旅程/ })).toBeNull();
  });

  it('进行中暂停需要确认，暂停后出现恢复和编辑入口', async () => {
    mockDetailSequence([runningCampaign]);
    mock.onPost(`/campaigns/${campaignId}/pause`).reply(200, { data: pausedCampaign });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '暂停活动' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        '暂停后可修改活动资料，新建或调整旅程；只能删除从未发布过的旅程。未发布内容不会应用。',
      ),
    ).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: '暂停活动' }));

    expect(await screen.findByText('活动已暂停')).toBeDefined();
    expect(within(page()).getByRole('button', { name: '恢复活动' })).toBeDefined();
    expect(within(page()).getByRole('button', { name: '编辑活动' })).toBeDefined();
    expect(within(page()).getByRole('button', { name: '停止活动' })).toBeDefined();
    expect(within(page()).queryByRole('button', { name: '启动活动' })).toBeNull();
    expect(within(page()).queryByRole('button', { name: '删除活动' })).toBeNull();
    // 暂停是维护窗口：旅程区域恢复新建入口（按钮名包含图标标签）。
    expect(screen.getByRole('button', { name: /新建旅程/ })).toBeDefined();
  });

  it('已暂停恢复后回到进行中，停止确认的取消按钮为保持暂停', async () => {
    mockDetailSequence([pausedCampaign]);
    mock.onPost(`/campaigns/${campaignId}/resume`).reply(200, { data: runningCampaign });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '停止活动' }));
    const stopDialog = await screen.findByRole('dialog');
    expect(within(stopDialog).getByRole('button', { name: '保持暂停' })).toBeDefined();
    fireEvent.click(within(stopDialog).getByRole('button', { name: '保持暂停' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.history.post).toHaveLength(0);

    fireEvent.click(within(page()).getByRole('button', { name: '恢复活动' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('恢复后，活动资料和旅程将不能修改。未发布的内容不会应用。'),
    ).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复活动' }));

    expect(await screen.findByText('活动已恢复')).toBeDefined();
    expect(within(page()).getByRole('button', { name: '暂停活动' })).toBeDefined();
    expect(within(page()).queryByRole('button', { name: '编辑活动' })).toBeNull();
    expect(within(page()).queryByRole('button', { name: '恢复活动' })).toBeNull();
  });

  it('启动请求进行中时不能重复发起', async () => {
    mockDetailSequence([draftCampaign]);
    let releaseStart!: () => void;
    const startGate = new Promise<[number, unknown]>((resolve) => {
      releaseStart = () => resolve([200, { data: runningCampaign }]);
    });
    mock.onPost(`/campaigns/${campaignId}/start`).reply(() => startGate);
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '启动活动' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '启动活动' }));

    await waitFor(() =>
      expect(
        within(page()).getByRole('button', { name: '启动活动' }).hasAttribute('disabled'),
      ).toBe(true),
    );
    fireEvent.click(within(page()).getByRole('button', { name: '启动活动' }));
    expect(mock.history.post).toHaveLength(1);

    releaseStart();
    expect(await screen.findByText('活动已启动')).toBeDefined();
  });

  it('编辑抽屉在保存被拒绝后保留输入，关闭后按真实状态刷新', async () => {
    mockDetailSequence([draftCampaign, runningCampaign]);
    mock
      .onPatch(`/campaigns/${campaignId}`)
      .reply(409, errorBody('CAMPAIGN_NOT_EDITABLE', '只有草稿或已暂停的活动可以修改'));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '编辑活动' }));
    const drawer = await screen.findByRole('dialog', { name: '编辑活动' });
    const nameInput = within(drawer).getByLabelText('活动名称');
    fireEvent.change(nameInput, { target: { value: '改过的名字' } });
    fireEvent.click(within(drawer).getByRole('button', { name: '保存修改' }));

    expect(await within(drawer).findByText('只有草稿或已暂停的活动可以修改')).toBeDefined();
    expect((nameInput as HTMLInputElement).value).toBe('改过的名字');

    // antd 会在两个汉字的按钮文案中间插入空格。
    fireEvent.click(within(drawer).getByRole('button', { name: '取 消' }));
    expect(await screen.findByText('已填写的内容不会保存。')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));

    expect(await screen.findByRole('button', { name: '停止活动' })).toBeDefined();
    expect(within(page()).queryByRole('button', { name: '编辑活动' })).toBeNull();
  });

  it('启动成功后，先发出的旧详情读取不会把页面覆盖回草稿', async () => {
    let detailReads = 0;
    let releaseStaleDetail!: () => void;
    const staleDetail = new Promise<[number, unknown]>((resolve) => {
      releaseStaleDetail = () => resolve([200, { data: draftCampaign }]);
    });
    mock.onGet(`/campaigns/${campaignId}`).reply(() => {
      detailReads += 1;
      return detailReads === 1 ? [200, { data: draftCampaign }] : staleDetail;
    });
    mock.onPost(`/campaigns/${campaignId}/start`).reply(200, { data: runningCampaign });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: '启动活动' }));

    // 模拟进入页面时发出的详情读取仍未返回。
    void queryClient!
      .refetchQueries({ queryKey: campaignQueryKeys.detail(campaignId) })
      .catch(() => {});
    await waitFor(() => expect(detailReads).toBe(2));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '启动活动' }));
    expect(await screen.findByText('活动已启动')).toBeDefined();

    // 放行更早发出的读取：它带回草稿，不能覆盖已经启动的状态。
    releaseStaleDetail();
    await act(async () => {
      // 等旧响应走完 axios 的响应链真正写入缓存。
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(within(page()).getByRole('button', { name: '停止活动' })).toBeDefined();
    expect(within(page()).queryByRole('button', { name: '编辑活动' })).toBeNull();
    expect(screen.queryByRole('button', { name: /新建旅程/ })).toBeNull();
    // 取消旧读取不能让页面进入刷新失败状态。
    expect(screen.queryByText(/无法刷新/)).toBeNull();
    expect(screen.queryByText(/服务暂时不可用/)).toBeNull();
  });

  it('返回活动列表时保留原有筛选条件', async () => {
    mockDetailSequence([draftCampaign]);
    mock.onGet('/campaigns').reply(200, {
      data: [],
      page: { page: 1, pageSize: 10, total: 0 },
    });
    const router = renderDetail({ returnTo: '?q=春季&page=2' });

    fireEvent.click(await screen.findByRole('button', { name: '返回活动列表' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/campaigns'));
    expect(router.state.location.search).toBe('?q=春季&page=2');
  });
});
