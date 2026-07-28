import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { onlineManager, useQueryClient, type QueryClient } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthProvider } from '@/features/auth/auth-provider';
import { QueryProvider } from '@/app/QueryProvider';
import { apiClient } from '@/services/api';
import { appRoutes } from '@/app/router';

let mock: MockAdapter;
let queryClient: QueryClient | undefined;

const account = {
  id: 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120',
  email: 'operator@example.com',
  displayName: 'JourneyLens 管理员',
};
const campaign = {
  id: '2d4f4d57-9d59-4ed5-a2fa-d71733cebb60',
  name: '春季活动',
  description: null,
  budget: null,
  status: 'draft',
  createdAt: '2026-07-17T08:00:00.000Z',
  updatedAt: '2026-07-17T08:00:00.000Z',
  createdBy: { id: account.id, displayName: account.displayName },
};
const summary = {
  id: campaign.id,
  name: campaign.name,
  description: campaign.description,
  budget: campaign.budget,
  status: campaign.status,
  updatedAt: campaign.updatedAt,
  createdBy: campaign.createdBy,
  journeyCount: 0,
};
const unauthorizedBody = {
  error: { code: 'AUTH_REQUIRED', message: '登录已失效', requestId: 'test-request-id' },
};
const serverErrorBody = {
  error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId: 'test-request-id' },
};

function listBody(
  data: unknown[] = [],
  pageOverrides: Partial<{
    page: number;
    pageSize: number;
    total: number;
  }> = {},
) {
  return {
    data,
    page: {
      page: 1,
      pageSize: 10,
      total: data.length,
      ...pageOverrides,
    },
  };
}

function renderApp(initialPath = '/') {
  mock.onGet(/\/campaigns\/[^/]+\/journeys$/).reply(200, listBody());
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

function listParams() {
  return mock.history.get
    .filter((request) => request.url === '/campaigns')
    .map((request) => request.params as Record<string, unknown>);
}

function detailRequests(id: string) {
  return mock.history.get.filter((request) => request.url === `/campaigns/${id}`);
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

describe('活动列表与创建', () => {
  it('操作列按草稿状态和旅程数量禁用删除', async () => {
    const linkedDraft = {
      ...summary,
      id: '2d4f4d57-9d59-4ed5-a2fa-d71733cebb61',
      name: '有旅程的草稿',
      journeyCount: 1,
    };
    const scheduled = {
      ...summary,
      id: '2d4f4d57-9d59-4ed5-a2fa-d71733cebb62',
      name: '已排期活动',
      status: 'scheduled',
    };
    const paused = {
      ...summary,
      id: '2d4f4d57-9d59-4ed5-a2fa-d71733cebb63',
      name: '已暂停活动',
      status: 'paused',
    };
    const deletable = { ...summary, name: '可删除活动' };
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/campaigns').reply(200, listBody([linkedDraft, scheduled, paused, deletable]));
    renderApp();

    const linkedRow = await screen.findByRole('row', { name: /有旅程的草稿/ });
    const scheduledRow = screen.getByRole('row', { name: /已排期活动/ });
    const pausedRow = screen.getByRole('row', { name: /已暂停活动/ });
    const deletableRow = screen.getByRole('row', { name: /可删除活动/ });
    expect(within(linkedRow).getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(
      within(scheduledRow).getByRole('button', { name: '删除' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      within(deletableRow).getByRole('button', { name: '删除' }).hasAttribute('disabled'),
    ).toBe(false);
    // 暂停是维护窗口：可以编辑资料，但活动记录仍然保留。
    expect(within(pausedRow).getByText('已暂停')).toBeDefined();
    expect(within(pausedRow).getByRole('button', { name: '编辑' }).hasAttribute('disabled')).toBe(
      false,
    );
    expect(within(pausedRow).getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('编辑操作直接打开活动表单；确认删除后刷新当前列表', async () => {
    const editable = { ...summary, name: '列表中的活动' };
    const detail = { ...campaign, name: editable.name };
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/campaigns').replyOnce(200, listBody([editable]));
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(200, { data: detail });
    mock.onDelete(`/campaigns/${campaign.id}`).replyOnce(204);
    mock.onGet('/campaigns').replyOnce(200, listBody());
    renderApp();

    const row = await screen.findByRole('row', { name: /列表中的活动/ });
    fireEvent.click(within(row).getByRole('button', { name: '编辑' }));
    const nameInput = (await screen.findByLabelText('活动名称')) as HTMLInputElement;
    expect(nameInput.value).toBe(editable.name);
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(within(row).getByRole('button', { name: '删除' }));
    expect(await screen.findByText('确定删除“列表中的活动”活动吗？删除后无法恢复。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除活动' }));

    expect(await screen.findByText('暂无活动')).toBeTruthy();
    expect(mock.history.delete).toHaveLength(1);
    expect(mock.history.get.filter((request) => request.url === '/campaigns')).toHaveLength(2);
  }, 15_000);

  it('从真实列表打开创建表单，规范化后提交并重新读取活动', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/campaigns').replyOnce(200, listBody());
    mock.onPost('/campaigns').replyOnce(201, { data: campaign });
    mock.onGet('/campaigns').replyOnce(200, listBody([summary]));
    renderApp();

    expect(await screen.findByText('暂无活动')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /新建活动/ }));
    // 测试环境 rc-component 固定返回同一个 id，页面存在多个此类组件时抽屉标题的 aria 关联会失效。
    const createDrawer = await screen.findByRole('dialog');
    expect(within(createDrawer).getByText('新建活动')).toBeTruthy();
    expect(screen.getByLabelText('活动名称').getAttribute('aria-required')).toBe('true');
    expect(screen.getByLabelText('说明').getAttribute('aria-required')).toBeNull();
    expect(screen.getByLabelText('预算金额').getAttribute('aria-required')).toBeNull();
    expect(screen.queryByText(/可留空|可填写/)).toBeNull();
    fireEvent.change(screen.getByLabelText('活动名称'), { target: { value: '  春季活动  ' } });
    fireEvent.change(screen.getByLabelText('说明'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '创建活动' }));

    expect(await screen.findByText('春季活动')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '新建活动' })).toBeNull();
    expect(mock.history.post).toHaveLength(1);
    expect(mock.history.post[0]?.url).toBe('/campaigns');
    expect(mock.history.post[0]?.baseURL).toBe('/api');
    expect(JSON.parse(String(mock.history.post[0]?.data))).toEqual({
      name: '春季活动',
      description: null,
    });
    expect(listParams()).toEqual([{}, {}]);
    expect(mock.history.get.map((request) => request.url)).toEqual([
      '/userinfo',
      '/campaigns',
      '/campaigns',
    ]);
    expect(mock.history.get[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('创建时校验预算并以十进制字符串保存', async () => {
    const budgetedCampaign = { ...campaign, name: '带预算活动', budget: { amount: '100.25' } };
    const budgetedSummary = { ...summary, name: budgetedCampaign.name };
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/campaigns').replyOnce(200, listBody());
    mock.onPost('/campaigns').replyOnce(201, { data: budgetedCampaign });
    mock.onGet('/campaigns').replyOnce(200, listBody([budgetedSummary]));
    renderApp('/campaigns');

    await screen.findByText('暂无活动');
    fireEvent.click(screen.getByRole('button', { name: /新建活动/ }));
    fireEvent.change(await screen.findByLabelText('活动名称'), {
      target: { value: '带预算活动' },
    });
    fireEvent.change(screen.getByLabelText('说明'), { target: { value: '预算说明' } });
    fireEvent.change(screen.getByLabelText('预算金额'), { target: { value: '1e3' } });
    fireEvent.click(screen.getByRole('button', { name: '创建活动' }));

    expect(await screen.findByText('请输入非负金额，最多 12 位整数和 2 位小数')).toBeTruthy();
    expect(mock.history.post).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('预算金额'), { target: { value: '100.25' } });
    fireEvent.click(screen.getByRole('button', { name: '创建活动' }));
    expect(await screen.findByRole('link', { name: '带预算活动' })).toBeTruthy();
    expect(JSON.parse(String(mock.history.post[0]?.data))).toEqual({
      name: '带预算活动',
      description: '预算说明',
      budget: { amount: '100.25' },
    });
  }, 10_000);

  it('可输入页码跳转、选择每页条数，筛选和搜索回到第一页', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock
      .onGet('/campaigns')
      .replyOnce(200, listBody([summary], { page: 2, pageSize: 20, total: 61 }));
    mock
      .onGet('/campaigns')
      .replyOnce(200, listBody([summary], { page: 3, pageSize: 20, total: 61 }));
    mock.onGet('/campaigns').replyOnce(200, listBody([summary], { pageSize: 20, total: 51 }));
    mock
      .onGet('/campaigns')
      .replyOnce(200, listBody([summary], { page: 2, pageSize: 20, total: 51 }));
    mock.onGet('/campaigns').replyOnce(200, listBody([summary], { pageSize: 50, total: 51 }));
    mock.onGet('/campaigns').replyOnce(200, listBody([summary], { pageSize: 50, total: 1 }));
    mock.onGet('/campaigns').replyOnce(200, listBody([summary], { pageSize: 50, total: 1 }));
    renderApp('/campaigns?q=spring&status=draft&page=2&pageSize=20');

    expect(await screen.findByRole('link', { name: campaign.name })).toBeTruthy();
    expect(listParams()[0]).toEqual({ q: 'spring', status: 'draft', page: 2, pageSize: 20 });
    expect(screen.getByRole('combobox', { name: '状态' })).toBeTruthy();
    expect(screen.getByText(/跳至/)).toBeTruthy();

    const pageInput = screen.getByRole('textbox', { name: '页' });
    fireEvent.change(pageInput, { target: { value: '3' } });
    fireEvent.keyUp(pageInput, { key: 'Enter', code: 'Enter', keyCode: 13, charCode: 13 });
    await waitFor(() =>
      expect(listParams()).toContainEqual({
        q: 'spring',
        status: 'draft',
        page: 3,
        pageSize: 20,
      }),
    );

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '状态' }));
    // 虚拟列表只给可见选项生成 role，按选项文本点击实际渲染的条目。
    fireEvent.click(await screen.findByText('已结束'));
    expect(listParams()).not.toContainEqual({ q: 'spring', status: 'ended', pageSize: 20 });
    fireEvent.click(screen.getByRole('button', { name: /^查\s*询$/ }));
    await waitFor(() =>
      expect(listParams()).toContainEqual({ q: 'spring', status: 'ended', pageSize: 20 }),
    );

    fireEvent.click(screen.getByRole('listitem', { name: '2' }));
    await waitFor(() =>
      expect(listParams()).toContainEqual({
        q: 'spring',
        status: 'ended',
        page: 2,
        pageSize: 20,
      }),
    );

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '每页条数' }));
    fireEvent.click(await screen.findByRole('option', { name: '50 条/页' }));
    await waitFor(() =>
      expect(listParams()).toContainEqual({ q: 'spring', status: 'ended', pageSize: 50 }),
    );

    fireEvent.change(screen.getByLabelText('关键词'), {
      target: { value: 'autumn' },
    });
    expect(listParams()).not.toContainEqual({ q: 'autumn', status: 'ended', pageSize: 50 });
    fireEvent.click(screen.getByRole('button', { name: /^查\s*询$/ }));
    await waitFor(() =>
      expect(listParams()).toContainEqual({ q: 'autumn', status: 'ended', pageSize: 50 }),
    );

    fireEvent.click(screen.getByRole('button', { name: /^重\s*置$/ }));
    await waitFor(() => expect(listParams()).toContainEqual({ pageSize: 50 }));
    expect((screen.getByLabelText('关键词') as HTMLInputElement).value).toBe('');
  }, 20_000);

  it('网址中的每页条数不合法时明确提示，不静默改成 10 条', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    const router = renderApp('/campaigns?pageSize=17');

    expect(await screen.findByText('每页条数只能选择 10、20 或 50 条')).toBeTruthy();
    expect(router.state.location.search).toBe('?pageSize=17');
    expect(listParams()).toHaveLength(0);
  });

  it('读取失败时不显示空列表，并允许重新读取', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/campaigns').networkErrorOnce();
    mock.onGet('/campaigns').replyOnce(200, listBody());
    renderApp();

    expect(await screen.findByText('无法连接服务器，请稍后重试')).toBeTruthy();
    expect(screen.queryByText('暂无活动')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('暂无活动')).toBeTruthy();
  });

  it('创建失败保留输入；创建成功但刷新失败时提示已创建并提供重试', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/campaigns').replyOnce(200, listBody());
    mock.onPost('/campaigns').replyOnce(500, serverErrorBody);
    mock.onPost('/campaigns').replyOnce(201, { data: campaign });
    mock.onGet('/campaigns').networkErrorOnce();
    mock.onGet('/campaigns').replyOnce(200, listBody([summary]));
    renderApp();

    await screen.findByText('暂无活动');
    fireEvent.click(screen.getByRole('button', { name: /新建活动/ }));
    fireEvent.change(await screen.findByLabelText('活动名称'), { target: { value: '春季活动' } });
    fireEvent.click(screen.getByRole('button', { name: '创建活动' }));
    expect(await screen.findByText('服务暂时不可用')).toBeTruthy();
    expect((screen.getByLabelText('活动名称') as HTMLInputElement).value).toBe('春季活动');

    fireEvent.click(screen.getByRole('button', { name: '创建活动' }));
    expect(await screen.findByText('活动已创建，列表暂时无法刷新')).toBeTruthy();
    expect(screen.queryByText('暂无活动')).toBeNull();
    expect(screen.queryByRole('dialog', { name: '新建活动' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('春季活动')).toBeTruthy();
    // 重试只重新读取列表，不重复提交创建。
    expect(mock.history.post).toHaveLength(2);
  }, 10_000);

  it('创建请求超时时提示结果未确认，不自动重复提交', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/campaigns').replyOnce(200, listBody());
    mock.onPost('/campaigns').timeoutOnce();
    renderApp();

    await screen.findByText('暂无活动');
    fireEvent.click(screen.getByRole('button', { name: /新建活动/ }));
    fireEvent.change(await screen.findByLabelText('活动名称'), { target: { value: '春季活动' } });
    fireEvent.click(screen.getByRole('button', { name: '创建活动' }));

    expect(await screen.findByText('请求超时，操作结果未确认，请稍后核实')).toBeTruthy();
    expect((screen.getByLabelText('活动名称') as HTMLInputElement).value).toBe('春季活动');
    expect(mock.history.post).toHaveLength(1);
  });

  it('离线时读取和写入仍立即发起，不暂停等待联网', async () => {
    onlineManager.setOnline(false);
    try {
      mock.onGet('/userinfo').reply(200, { data: account });
      mock.onGet('/campaigns').replyOnce(200, listBody());
      mock.onPost('/campaigns').networkErrorOnce();
      renderApp();

      expect(await screen.findByText('暂无活动')).toBeTruthy();
      expect(listParams()).toHaveLength(1);

      fireEvent.click(screen.getByRole('button', { name: /新建活动/ }));
      fireEvent.change(await screen.findByLabelText('活动名称'), {
        target: { value: '离线活动' },
      });
      fireEvent.click(screen.getByRole('button', { name: '创建活动' }));

      expect(await screen.findByText('无法连接服务器，请稍后重试')).toBeTruthy();
      expect(mock.history.post).toHaveLength(1);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('提交中阻止再次提交和关闭表单', async () => {
    let finishCreate!: () => void;
    const pendingCreate = new Promise<[number, unknown]>((resolve) => {
      finishCreate = () => resolve([201, { data: campaign }]);
    });
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/campaigns').replyOnce(200, listBody());
    mock.onPost('/campaigns').replyOnce(() => pendingCreate);
    mock.onGet('/campaigns').replyOnce(200, listBody([summary]));
    renderApp();

    await screen.findByText('暂无活动');
    fireEvent.click(screen.getByRole('button', { name: /新建活动/ }));
    fireEvent.change(await screen.findByLabelText('活动名称'), { target: { value: '春季活动' } });
    const submitButton = screen.getByRole('button', { name: '创建活动' }) as HTMLButtonElement;
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);
    await waitFor(() => expect(mock.history.post).toHaveLength(1));

    const pendingSubmitButton = screen.getByRole('button', {
      name: /正在创建/,
    }) as HTMLButtonElement;
    expect(pendingSubmitButton.disabled).toBe(true);
    fireEvent.click(pendingSubmitButton);
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(mock.history.post).toHaveLength(1);
    const submittingDrawer = screen.getByRole('dialog');
    expect(within(submittingDrawer).getByText('新建活动')).toBeTruthy();

    finishCreate();
    expect(await screen.findByText('春季活动')).toBeTruthy();
  }, 15_000);

  it('输入后关闭需要确认；放弃后焦点回到新建按钮', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/campaigns').replyOnce(200, listBody());
    renderApp();
    await screen.findByText('暂无活动');
    const openButton = screen.getByRole('button', { name: /新建活动/ });
    fireEvent.click(openButton);
    fireEvent.change(await screen.findByLabelText('活动名称'), { target: { value: '待放弃' } });
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));

    expect(await screen.findByText('已填写的内容不会保存。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '继续填写' }));
    await waitFor(() => expect(screen.queryByText('已填写的内容不会保存。')).toBeNull());
    expect((screen.getByLabelText('活动名称') as HTMLInputElement).value).toBe('待放弃');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃填写' }));

    await waitFor(() => expect(document.activeElement).toBe(openButton));
    await waitFor(() => expect(screen.queryByText('已填写的内容不会保存。')).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
  }, 10_000);

  it('业务请求返回登录失效时回到登录页', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/campaigns').replyOnce(401, unauthorizedBody);
    const router = renderApp();

    expect(await screen.findByRole('heading', { name: '登录 JourneyLens' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('写入请求返回登录失效时回到登录页，不在表单重复提示', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/campaigns').replyOnce(200, listBody());
    mock.onPost('/campaigns').replyOnce(401, unauthorizedBody);
    const router = renderApp();

    await screen.findByText('暂无活动');
    fireEvent.click(screen.getByRole('button', { name: /新建活动/ }));
    fireEvent.change(await screen.findByLabelText('活动名称'), { target: { value: '春季活动' } });
    fireEvent.click(screen.getByRole('button', { name: '创建活动' }));

    expect(await screen.findByRole('heading', { name: '登录 JourneyLens' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('从列表进入详情，返回时重新读取列表', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock
      .onGet('/campaigns')
      .replyOnce(200, listBody([summary], { page: 2, pageSize: 20, total: 21 }));
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(200, { data: campaign });
    mock
      .onGet('/campaigns')
      .replyOnce(200, listBody([summary], { page: 2, pageSize: 20, total: 21 }));
    const router = renderApp('/campaigns?q=spring&status=draft&page=2&pageSize=20');

    fireEvent.click(await screen.findByRole('link', { name: campaign.name }));
    expect(await screen.findByText('未填写')).toBeTruthy();
    expect(screen.getByRole('cell', { name: campaign.createdBy.displayName })).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/campaigns/${campaign.id}`);
    expect(listParams()[0]).toEqual({ q: 'spring', status: 'draft', page: 2, pageSize: 20 });
    expect(mock.history.get.map((request) => request.url)).toContain(`/campaigns/${campaign.id}`);

    fireEvent.click(screen.getByRole('button', { name: '返回活动列表' }));
    expect(await screen.findByRole('link', { name: campaign.name })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/campaigns');
    expect(router.state.location.search).toBe('?q=spring&status=draft&page=2&pageSize=20');
    expect(listParams()).toHaveLength(2);
    expect(listParams()[1]).toEqual({ q: 'spring', status: 'draft', page: 2, pageSize: 20 });
  });

  it('重新进入已缓存的详情时保留内容，刷新失败显示提示并可重试', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(200, { data: campaign });
    mock.onGet('/campaigns').replyOnce(200, listBody([summary]));
    mock.onGet(`/campaigns/${campaign.id}`).networkErrorOnce();
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(200, { data: campaign });
    const router = renderApp(`/campaigns/${campaign.id}`);

    expect(await screen.findByRole('cell', { name: campaign.name })).toBeTruthy();
    await router.navigate('/campaigns');
    expect(await screen.findByRole('link', { name: campaign.name })).toBeTruthy();
    await router.navigate(`/campaigns/${campaign.id}`);

    expect(await screen.findByText('活动暂时无法刷新')).toBeTruthy();
    expect(screen.getByText('无法连接服务器，请稍后重试')).toBeTruthy();
    expect(screen.getByRole('cell', { name: campaign.name })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(screen.queryByText('活动暂时无法刷新')).toBeNull());
    expect(screen.getByRole('cell', { name: campaign.name })).toBeTruthy();
  }, 15_000);

  it('删除后如果原页已越界，会回到最后一页并更新网址', async () => {
    const lastSummary = {
      ...summary,
      id: '2d4f4d57-9d59-4ed5-a2fa-d71733cebb61',
      name: '最后一条活动',
    };
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/campaigns').replyOnce(200, listBody([summary], { page: 2, total: 11 }));
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(200, { data: campaign });
    mock.onDelete(`/campaigns/${campaign.id}`).replyOnce(204);
    mock.onGet('/campaigns').replyOnce(200, listBody([lastSummary], { page: 1, total: 10 }));
    mock.onGet('/campaigns').replyOnce(200, listBody([lastSummary], { page: 1, total: 10 }));
    const router = renderApp('/campaigns?page=2&pageSize=10');

    fireEvent.click(await screen.findByRole('link', { name: campaign.name }));
    await screen.findByText('未填写');
    fireEvent.click(screen.getByRole('button', { name: '删除活动' }));
    const confirmation = await screen.findByRole('dialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: '删除活动' }));

    expect(await screen.findByRole('link', { name: '最后一条活动' })).toBeTruthy();
    await waitFor(() => expect(router.state.location.search).toBe('?pageSize=10'));
    await waitFor(() => expect(listParams()).toEqual([{ page: 2 }, { page: 2 }, {}]));
    expect(mock.history.delete).toHaveLength(1);
  });

  it('编辑回填真实详情，清空说明和预算后保存并重读详情', async () => {
    const initial = { ...campaign, description: '原说明', budget: { amount: '50.00' } };
    const updated = {
      ...initial,
      name: '修改后的活动',
      description: null,
      budget: null,
      updatedAt: '2026-07-17T08:01:00.000Z',
    };
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(200, { data: initial });
    mock.onPatch(`/campaigns/${campaign.id}`).replyOnce(200, { data: updated });
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(200, { data: updated });
    const router = renderApp(`/campaigns/${campaign.id}`);

    expect(await screen.findByRole('cell', { name: '50.00' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑活动' }));
    expect(((await screen.findByLabelText('活动名称')) as HTMLInputElement).value).toBe(
      campaign.name,
    );
    expect((screen.getByLabelText('说明') as HTMLTextAreaElement).value).toBe('原说明');
    expect((screen.getByLabelText('预算金额') as HTMLInputElement).value).toBe('50.00');

    fireEvent.change(screen.getByLabelText('活动名称'), {
      target: { value: '修改后的活动' },
    });
    fireEvent.change(screen.getByLabelText('说明'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('预算金额'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByRole('cell', { name: '修改后的活动' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '未填写' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '未设置' })).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/campaigns/${campaign.id}`);
    expect(mock.history.patch).toHaveLength(1);
    expect(mock.history.patch[0]?.url).toBe(`/campaigns/${campaign.id}`);
    expect(JSON.parse(String(mock.history.patch[0]?.data))).toEqual({
      name: '修改后的活动',
      description: null,
      budget: null,
    });
    expect(detailRequests(campaign.id)).toHaveLength(2);
    expect(listParams()).toHaveLength(0);
  }, 15_000);

  it('编辑初始值不触发未保存确认，修改后关闭会确认并返回焦点', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaign.id}`).reply(200, { data: campaign });
    renderApp(`/campaigns/${campaign.id}`);

    await screen.findByRole('cell', { name: campaign.name });
    const editButton = screen.getByRole('button', { name: '编辑活动' });
    fireEvent.click(editButton);
    await screen.findByRole('dialog', { name: '编辑活动' });
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑活动' })).toBeNull());
    expect(screen.queryByText('已填写的内容不会保存。')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(editButton));

    fireEvent.click(editButton);
    fireEvent.change(await screen.findByLabelText('活动名称'), {
      target: { value: '未保存的名称' },
    });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(await screen.findByText('已填写的内容不会保存。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '继续填写' }));
    await waitFor(() => expect(screen.queryByText('已填写的内容不会保存。')).toBeNull());
    expect((screen.getByLabelText('活动名称') as HTMLInputElement).value).toBe('未保存的名称');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑活动' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(editButton));
    expect(mock.history.patch).toHaveLength(0);
  }, 15_000);

  it('修改失败保留输入；保存成功但刷新失败提示已保存并可重试', async () => {
    const initial = { ...campaign, description: '原说明', budget: { amount: '50.00' } };
    const updated = { ...initial, name: '修改后的活动' };
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(200, { data: initial });
    mock.onPatch(`/campaigns/${campaign.id}`).replyOnce(500, serverErrorBody);
    mock.onPatch(`/campaigns/${campaign.id}`).replyOnce(200, { data: updated });
    mock.onGet(`/campaigns/${campaign.id}`).networkErrorOnce();
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(200, { data: updated });
    renderApp(`/campaigns/${campaign.id}`);

    await screen.findByRole('cell', { name: campaign.name });
    fireEvent.click(screen.getByRole('button', { name: '编辑活动' }));
    const nameInput = (await screen.findByLabelText('活动名称')) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '修改后的活动' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(await screen.findByText('服务暂时不可用')).toBeTruthy();
    expect((screen.getByLabelText('活动名称') as HTMLInputElement).value).toBe('修改后的活动');

    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(await screen.findByText('活动已保存，暂时无法刷新')).toBeTruthy();
    expect(screen.getByRole('cell', { name: '修改后的活动' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByRole('cell', { name: '修改后的活动' })).toBeTruthy();
    expect(mock.history.patch).toHaveLength(2);
  }, 15_000);

  it('取消删除不发请求；确认后删除并让旧详情显示不存在', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(200, { data: campaign });
    mock.onDelete(`/campaigns/${campaign.id}`).replyOnce(204);
    mock.onGet('/campaigns').replyOnce(200, listBody());
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(404, {
      error: { code: 'NOT_FOUND', message: '活动不存在', requestId: 'test-request-id' },
    });
    const router = renderApp(`/campaigns/${campaign.id}`);

    await screen.findByRole('cell', { name: campaign.name });
    fireEvent.click(screen.getByRole('button', { name: '删除活动' }));
    const firstConfirmation = await screen.findByRole('dialog');
    expect(
      within(firstConfirmation).getByText('确定删除“春季活动”活动吗？删除后无法恢复。'),
    ).toBeTruthy();
    fireEvent.click(within(firstConfirmation).getByRole('button', { name: '保留活动' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.history.delete).toHaveLength(0);
    expect(screen.getByRole('cell', { name: campaign.name })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '删除活动' }));
    const secondConfirmation = await screen.findByRole('dialog');
    fireEvent.click(within(secondConfirmation).getByRole('button', { name: '删除活动' }));
    expect(await screen.findByText('暂无活动')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/campaigns');
    expect(mock.history.delete).toHaveLength(1);

    await router.navigate(`/campaigns/${campaign.id}`);
    expect(await screen.findByText('活动不存在')).toBeTruthy();
  }, 15_000);

  it('删除失败保留详情；删除成功但列表刷新失败时准确提示并可重试', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(200, { data: campaign });
    mock.onDelete(`/campaigns/${campaign.id}`).replyOnce(500, serverErrorBody);
    mock.onDelete(`/campaigns/${campaign.id}`).replyOnce(204);
    mock.onGet('/campaigns').networkErrorOnce();
    mock.onGet('/campaigns').replyOnce(200, listBody());
    renderApp(`/campaigns/${campaign.id}`);

    await screen.findByRole('cell', { name: campaign.name });
    fireEvent.click(screen.getByRole('button', { name: '删除活动' }));
    const failedDeleteConfirmation = await screen.findByRole('dialog');
    fireEvent.click(within(failedDeleteConfirmation).getByRole('button', { name: '删除活动' }));
    expect(await screen.findByText('服务暂时不可用')).toBeTruthy();
    expect(screen.getByRole('cell', { name: campaign.name })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '删除活动' }));
    const successfulDeleteConfirmation = await screen.findByRole('dialog');
    fireEvent.click(within(successfulDeleteConfirmation).getByRole('button', { name: '删除活动' }));
    expect(await screen.findByText('活动已删除，列表暂时无法刷新')).toBeTruthy();
    expect(screen.queryByText(campaign.name)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByText('暂无活动')).toBeTruthy();
    expect(mock.history.delete).toHaveLength(2);
  }, 15_000);

  it('直接打开活动详情地址并区分不存在的活动', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(404, {
      error: { code: 'NOT_FOUND', message: '活动不存在', requestId: 'test-request-id' },
    });
    mock.onGet('/campaigns').replyOnce(200, listBody());
    const router = renderApp(`/campaigns/${campaign.id}`);

    expect(await screen.findByText('活动不存在')).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/campaigns/${campaign.id}`);
    fireEvent.click(screen.getByRole('button', { name: '返回活动列表' }));
    expect(await screen.findByText('暂无活动')).toBeTruthy();
    expect(detailRequests(campaign.id)).toHaveLength(1);
  });

  it('详情读取失败可重试；过期登录会返回登录页', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(500, serverErrorBody);
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(200, { data: campaign });
    renderApp(`/campaigns/${campaign.id}`);

    expect(await screen.findByText('服务暂时不可用')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByRole('cell', { name: campaign.createdBy.displayName })).toBeTruthy();

    cleanup();
    queryClient?.clear();
    queryClient = undefined;
    mock.reset();
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaign.id}`).replyOnce(401, unauthorizedBody);
    const router = renderApp(`/campaigns/${campaign.id}`);
    expect(await screen.findByRole('heading', { name: '登录 JourneyLens' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('切换详情地址后忽略旧请求结果', async () => {
    const firstId = campaign.id;
    const secondId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb61';
    const secondCampaign = { ...campaign, id: secondId, name: '第二个活动' };
    let resolveFirst!: () => void;
    const pendingFirst = new Promise<[number, unknown]>((resolve) => {
      resolveFirst = () => resolve([200, { data: campaign }]);
    });
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${firstId}`).replyOnce(() => pendingFirst);
    mock.onGet(`/campaigns/${secondId}`).replyOnce(200, { data: secondCampaign });
    const router = renderApp(`/campaigns/${firstId}`);

    await screen.findByRole('heading', { name: '活动详情' });
    await waitFor(() => expect(detailRequests(firstId)).toHaveLength(1));
    await router.navigate(`/campaigns/${secondId}`);
    expect(await screen.findByRole('heading', { level: 2, name: '第二个活动' })).toBeTruthy();
    await act(async () => {
      resolveFirst();
    });
    expect(screen.getByRole('heading', { level: 2, name: '第二个活动' })).toBeTruthy();
    expect(screen.queryByText(campaign.name)).toBeNull();
  });
});
