import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { ConfigProvider, Modal } from 'antd';
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
const campaignId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb60';
const journeyId = '88a0f727-a226-4cb4-9495-74364f8d0e33';
const segmentId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb61';
const campaign = {
  id: campaignId,
  name: '春季活动',
  description: null,
  budget: null,
  status: 'draft',
  createdAt: '2026-07-17T08:00:00.000Z',
  updatedAt: '2026-07-17T08:00:00.000Z',
  createdBy: { id: account.id, displayName: account.displayName },
};
const campaignListItem = {
  id: campaign.id,
  name: campaign.name,
  description: campaign.description,
  budget: campaign.budget,
  status: campaign.status,
  updatedAt: campaign.updatedAt,
  createdBy: campaign.createdBy,
  journeyCount: 0,
};
const rules = {
  kind: 'all',
  children: [
    { kind: 'compare', left: { source: 'user', path: 'age' }, operator: 'gte', right: 30 },
  ],
};
const segmentListItem = {
  id: segmentId,
  name: '高价值会员',
  description: null,
  rules,
  updatedAt: '2026-07-19T00:00:00.000Z',
  audienceEstimate: null,
  journeyCount: 0,
};
const segment = {
  ...segmentListItem,
  description: '用于旅程入口',
  revision: 1,
  createdAt: segmentListItem.updatedAt,
  createdBy: { id: account.id, displayName: account.displayName },
  updatedBy: { id: account.id, displayName: account.displayName },
};
const journey = {
  id: journeyId,
  name: '欢迎旅程',
  description: '首次进入时发送欢迎内容',
  revision: 1,
  campaign: { id: campaignId, name: campaign.name, status: campaign.status },
  segment: { id: segment.id, name: segment.name, revision: segment.revision, rules },
  createdAt: '2026-07-19T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
  createdBy: { id: account.id, displayName: account.displayName },
  updatedBy: { id: account.id, displayName: account.displayName },
};
const journeyListItem = {
  id: journey.id,
  name: journey.name,
  description: journey.description,
  segment: { id: segment.id, name: segment.name },
  updatedAt: journey.updatedAt,
};
const unauthorizedBody = {
  error: { code: 'AUTH_REQUIRED', message: '登录已失效', requestId: 'test-request-id' },
};

function listBody(data: unknown[] = [], page = 1, pageSize = 10, total = data.length) {
  return { data, page: { page, pageSize, total } };
}

function renderApp(initialPath = `/campaigns/${campaignId}`) {
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

beforeEach(() => {
  mock = new MockAdapter(apiClient);
});

afterEach(() => {
  cleanup();
  queryClient?.clear();
  queryClient = undefined;
  mock.restore();
  Modal.destroyAll();
});

describe('活动旅程管理', () => {
  it('可搜索并选择分群后创建旅程，保存成功后重新读取列表', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaignId}`).reply(200, { data: campaign });
    mock.onGet(`/campaigns/${campaignId}/journeys`).replyOnce(200, listBody());
    mock.onGet(`/campaigns/${campaignId}/journeys`).replyOnce(200, listBody([journeyListItem]));
    mock.onGet('/segments').reply((config) => {
      const params = config.params as Record<string, string | number> | undefined;
      if (params?.q !== '会员') return [200, listBody()];
      const page = Number(params.page ?? 1);
      const pageSize = Number(params.pageSize ?? 10);
      return [200, listBody([segmentListItem], page, pageSize, 21)];
    });
    mock.onGet(`/segments/${segmentId}`).reply(200, { data: segment });
    mock.onPost(`/campaigns/${campaignId}/journeys`).reply(201, { data: journey });
    renderApp();

    expect(await screen.findByText('暂无旅程')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /新建旅程/ }));
    fireEvent.change(await screen.findByLabelText('旅程名称'), {
      target: { value: '欢迎旅程' },
    });
    fireEvent.change(screen.getByLabelText('说明'), {
      target: { value: '首次进入时发送欢迎内容' },
    });
    fireEvent.click(screen.getByRole('button', { name: '展开分群列表' }));
    const picker = await screen.findByRole('region', { name: '选择入口分群' });
    fireEvent.change(within(picker).getByLabelText('搜索分群'), {
      target: { value: '会员' },
    });
    fireEvent.click(within(picker).getByRole('button', { name: /^查\s*询$/ }));
    expect(await within(picker).findByRole('textbox', { name: '页' })).toBeTruthy();
    fireEvent.change(within(picker).getByRole('textbox', { name: '页' }), {
      target: { value: '2' },
    });
    fireEvent.keyUp(within(picker).getByRole('textbox', { name: '页' }), {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      charCode: 13,
    });
    await waitFor(() =>
      expect(
        mock.history.get.some(
          (request) => request.url === '/segments' && request.params?.page === 2,
        ),
      ).toBe(true),
    );
    fireEvent.mouseDown(within(picker).getByRole('combobox', { name: '每页条数' }));
    fireEvent.click(await screen.findByRole('option', { name: '20 条/页' }));
    await waitFor(() =>
      expect(
        mock.history.get.some(
          (request) => request.url === '/segments' && request.params?.pageSize === 20,
        ),
      ).toBe(true),
    );
    fireEvent.click(await within(picker).findByRole('button', { name: '选择' }));

    expect(await screen.findByText('高价值会员')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '创建旅程' }));

    expect(await screen.findByRole('link', { name: '欢迎旅程' })).toBeTruthy();
    expect(JSON.parse(String(mock.history.post[0]?.data))).toEqual({
      name: '欢迎旅程',
      description: '首次进入时发送欢迎内容',
      segmentId,
    });
    expect(
      mock.history.get.filter((request) => request.url === `/campaigns/${campaignId}/journeys`),
    ).toHaveLength(2);
  }, 30_000);

  it('在抽屉内展开分群列表并弹窗查看分群规则', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaignId}`).reply(200, { data: campaign });
    mock.onGet(`/campaigns/${campaignId}/journeys`).reply(200, listBody());
    mock.onGet('/segments').reply(200, listBody([segmentListItem]));
    renderApp();

    await screen.findByText('暂无旅程');
    fireEvent.click(screen.getByRole('button', { name: /新建旅程/ }));
    const toggle = await screen.findByRole('button', { name: '展开分群列表' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    expect(await screen.findByRole('button', { name: '收起分群列表' })).toBeTruthy();
    const panel = await screen.findByRole('region', { name: '选择入口分群' });
    expect(await within(panel).findByText('高价值会员')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: '查看分群规则' }));

    // 测试环境下抽屉与弹窗共用 mock id，不能按无障碍名称定位，改用规则内容所在的弹窗。
    const ruleDialog = (await screen.findByText('全部满足')).closest<HTMLElement>(
      '[role="dialog"]',
    )!;
    expect(within(ruleDialog).getByText('年龄')).toBeTruthy();
    expect(within(ruleDialog).getByText('大于等于')).toBeTruthy();
    expect(within(ruleDialog).getByText('30')).toBeTruthy();
    fireEvent.click(within(ruleDialog).getByRole('button', { name: /^关\s*闭$/ }));

    await waitFor(() => expect(screen.queryByText('全部满足')).toBeNull());
    expect(await screen.findByRole('region', { name: '选择入口分群' })).toBeTruthy();
    expect(mock.history.post).toHaveLength(0);
  }, 15_000);

  it('编辑冲突时保留输入，读取最新内容前再次确认', async () => {
    const latest = { ...journey, name: '服务器上的新名称', revision: 2 };
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaignId}`).reply(200, { data: campaign });
    mock.onGet(`/campaigns/${campaignId}/journeys`).reply(200, listBody([journeyListItem]));
    mock.onGet(`/segments/${segmentId}`).reply(200, { data: segment });
    mock.onGet(`/journeys/${journeyId}`).replyOnce(200, { data: journey });
    mock.onGet(`/journeys/${journeyId}`).replyOnce(200, { data: latest });
    mock.onPatch(`/journeys/${journeyId}`).reply(409, {
      error: {
        code: 'JOURNEY_REVISION_CONFLICT',
        message: '旅程已被修改，请重新读取后再保存',
        requestId: 'test-request-id',
      },
    });
    renderApp();

    await screen.findByRole('link', { name: journey.name }, { timeout: 5_000 });
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    const nameField = await screen.findByLabelText('旅程名称');
    fireEvent.change(nameField, { target: { value: '我正在编辑的名称' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByText('旅程已被修改，请重新读取最新内容后再保存。')).toBeTruthy();
    expect((screen.getByLabelText('旅程名称') as HTMLInputElement).value).toBe('我正在编辑的名称');
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    expect(await screen.findByText('读取后会替换当前填写的内容。')).toBeTruthy();
    expect((screen.getByLabelText('旅程名称') as HTMLInputElement).value).toBe('我正在编辑的名称');
    fireEvent.click(screen.getByRole('button', { name: '读取最新内容' }));

    await waitFor(() => {
      expect((screen.getByLabelText('旅程名称') as HTMLInputElement).value).toBe(
        '服务器上的新名称',
      );
    });
    expect(mock.history.patch).toHaveLength(1);
    expect(
      mock.history.get.filter((request) => request.url === `/journeys/${journeyId}`),
    ).toHaveLength(2);
  }, 15_000);

  it('重新打开编辑时用本次读取的最新内容建立快照', async () => {
    const latest = { ...journey, name: '服务器上的新名称', revision: 2 };
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaignId}`).reply(200, { data: campaign });
    mock.onGet(`/campaigns/${campaignId}/journeys`).reply(200, listBody([journeyListItem]));
    mock.onGet(`/segments/${segmentId}`).reply(200, { data: segment });
    mock.onGet(`/journeys/${journeyId}`).replyOnce(200, { data: journey });
    mock.onGet(`/journeys/${journeyId}`).replyOnce(200, { data: latest });
    mock.onPatch(`/journeys/${journeyId}`).reply(200, { data: latest });
    renderApp();

    await screen.findByRole('link', { name: journey.name });
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    const firstField = await screen.findByLabelText('旅程名称');
    expect((firstField as HTMLInputElement).value).toBe(journey.name);
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('旅程名称') as HTMLInputElement).value).toBe(
        '服务器上的新名称',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(mock.history.patch).toHaveLength(1));
    expect(JSON.parse(String(mock.history.patch[0]?.data))).toMatchObject({
      revision: 2,
      name: '服务器上的新名称',
    });
  }, 30_000);

  it('从旅程详情返回活动时恢复活动旅程的搜索与分页网址', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaignId}`).reply(200, { data: campaign });
    mock
      .onGet(`/campaigns/${campaignId}/journeys`)
      .reply(200, listBody([journeyListItem], 2, 20, 25));
    mock.onGet(`/journeys/${journeyId}`).reply(200, { data: journey });
    const router = renderApp(`/campaigns/${campaignId}?q=welcome&page=2&pageSize=20`);
    fireEvent.click(await screen.findByRole('link', { name: '欢迎旅程' }));
    expect(await screen.findByText('首次进入时发送欢迎内容')).toBeTruthy();
    expect(
      mock.history.get.find((request) => request.url === `/campaigns/${campaignId}/journeys`)
        ?.params,
    ).toEqual({
      q: 'welcome',
      page: 2,
      pageSize: 20,
    });
    expect(screen.getByRole('menuitem', { name: '活动' }).className).toContain(
      'ant-menu-item-selected',
    );

    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/campaigns/${campaignId}`);
      expect(router.state.location.search).toBe('?q=welcome&page=2&pageSize=20');
    });
  }, 15_000);

  it('从活动列表进入旅程详情后仍保留活动列表的返回条件', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/campaigns').reply(200, listBody([campaignListItem], 2, 20, 25));
    mock.onGet(`/campaigns/${campaignId}`).reply(200, { data: campaign });
    mock
      .onGet(`/campaigns/${campaignId}/journeys`)
      .reply((config) =>
        config.params?.q === 'welcome'
          ? [200, listBody([journeyListItem])]
          : [200, listBody([], 1, 10, 25)],
      );
    mock.onGet(`/journeys/${journeyId}`).reply(200, { data: journey });
    const router = renderApp('/campaigns?q=spring&page=2&pageSize=20');

    fireEvent.click(await screen.findByRole('link', { name: campaign.name }));
    await screen.findByText('暂无旅程');
    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: 'welcome' } });
    fireEvent.click(screen.getByRole('button', { name: /^查\s*询$/ }));
    fireEvent.click(await screen.findByRole('link', { name: journey.name }));
    expect(router.state.location.state).toEqual({
      returnTo: `/campaigns/${campaignId}?q=welcome`,
      returnState: { returnTo: '?q=spring&page=2&pageSize=20' },
    });
    expect(await screen.findByText('首次进入时发送欢迎内容')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
    await waitFor(() =>
      expect(router.state.location.state).toEqual({ returnTo: '?q=spring&page=2&pageSize=20' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '返回活动列表' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/campaigns');
      expect(router.state.location.search).toBe('?q=spring&page=2&pageSize=20');
    });
  }, 15_000);

  it('直接打开旅程详情时按实际所属活动返回', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/journeys/${journeyId}`).reply(200, { data: journey });
    mock.onGet(`/campaigns/${campaignId}`).reply(200, { data: campaign });
    mock.onGet(`/campaigns/${campaignId}/journeys`).reply(200, listBody([journeyListItem]));
    const router = renderApp(`/journeys/${journeyId}`);

    expect(await screen.findByText('首次进入时发送欢迎内容')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/campaigns/${campaignId}`));
    expect(await screen.findByRole('heading', { name: '春季活动' })).toBeTruthy();
  }, 15_000);

  it('初次读取旅程失败时显示重试，不显示成空列表', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaignId}`).reply(200, { data: campaign });
    mock.onGet(`/campaigns/${campaignId}/journeys`).networkErrorOnce();
    mock.onGet(`/campaigns/${campaignId}/journeys`).reply(200, listBody());
    renderApp();

    expect(await screen.findByText('无法连接服务器，请稍后重试')).toBeTruthy();
    expect(screen.queryByText('暂无旅程')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('暂无旅程')).toBeTruthy();
  }, 15_000);

  it('编辑中取消会保护未保存内容并在放弃后恢复焦点', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaignId}`).reply(200, { data: campaign });
    mock.onGet(`/campaigns/${campaignId}/journeys`).reply(200, listBody());
    renderApp();

    await screen.findByText('暂无旅程');
    const createButton = screen.getByRole('button', { name: /新建旅程/ });
    fireEvent.click(createButton);
    fireEvent.change(await screen.findByLabelText('旅程名称'), {
      target: { value: '未保存的旅程' },
    });
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));

    expect(await screen.findByText('已填写的内容不会保存。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '继续填写' }));
    expect((screen.getByLabelText('旅程名称') as HTMLInputElement).value).toBe('未保存的旅程');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃填写' }));

    await waitFor(() => expect(document.activeElement).toBe(createButton));
    expect(mock.history.post).toHaveLength(0);
  }, 15_000);

  it('保存成功但列表刷新失败会分开提示，重试只读取列表', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaignId}`).reply(200, { data: campaign });
    mock.onGet(`/campaigns/${campaignId}/journeys`).replyOnce(200, listBody());
    mock.onGet(`/campaigns/${campaignId}/journeys`).networkErrorOnce();
    mock.onGet(`/campaigns/${campaignId}/journeys`).reply(200, listBody([journeyListItem]));
    mock.onPost(`/campaigns/${campaignId}/journeys`).reply(201, { data: journey });
    renderApp();

    await screen.findByText('暂无旅程');
    fireEvent.click(screen.getByRole('button', { name: /新建旅程/ }));
    fireEvent.change(await screen.findByLabelText('旅程名称'), {
      target: { value: journey.name },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建旅程' }));

    expect(await screen.findByText('旅程已保存，列表暂时无法刷新')).toBeTruthy();
    expect(screen.queryByText('保存失败')).toBeNull();
    expect(mock.history.post).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('link', { name: journey.name })).toBeTruthy();
    expect(mock.history.post).toHaveLength(1);
  }, 15_000);

  it('删除最后一页旅程后按服务端有效页码更新网址', async () => {
    const lastItem = {
      ...journeyListItem,
      id: '88a0f727-a226-4cb4-9495-74364f8d0e34',
      name: 'JM-02 最后一条旅程',
    };
    let listRequest = 0;
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaignId}`).reply(200, { data: campaign });
    mock.onGet(`/campaigns/${campaignId}/journeys`).reply(() => {
      listRequest += 1;
      return listRequest === 1
        ? [200, listBody([journeyListItem], 2, 10, 11)]
        : [200, listBody([lastItem], 1, 10, 10)];
    });
    mock.onDelete(`/journeys/${journeyListItem.id}`).reply(204);
    const router = renderApp(`/campaigns/${campaignId}?q=JM-02&page=2&pageSize=10`);

    expect(await screen.findByRole('link', { name: journeyListItem.name })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    const confirmation = await screen.findByRole('dialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: '删除旅程' }));

    expect(await screen.findByRole('link', { name: lastItem.name })).toBeTruthy();
    await waitFor(() => expect(router.state.location.search).toBe('?q=JM-02&pageSize=10'));
    expect(mock.history.delete).toHaveLength(1);
  }, 15_000);

  it('旅程读取返回登录失效时沿用统一登录流程', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaignId}`).reply(200, { data: campaign });
    mock.onGet(`/campaigns/${campaignId}/journeys`).reply(401, unauthorizedBody);
    const router = renderApp();

    expect(
      await screen.findByRole('heading', { name: '登录 JourneyLens' }, { timeout: 5_000 }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
  }, 15_000);

  it('活动删除受旅程阻止时可回到旅程列表处理', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaignId}`).reply(200, { data: campaign });
    mock.onGet(`/campaigns/${campaignId}/journeys`).reply(200, listBody([journeyListItem]));
    mock.onDelete(`/campaigns/${campaignId}`).reply(409, {
      error: {
        code: 'CAMPAIGN_HAS_JOURNEYS',
        message: '活动中还有旅程，请先删除旅程',
        requestId: 'test-request-id',
      },
    });
    renderApp();

    expect(await screen.findByRole('link', { name: '欢迎旅程' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除活动' }));
    const confirmation = await screen.findByRole('dialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: '删除活动' }));

    expect(await screen.findByText('活动中还有旅程，请先删除旅程')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: '查看旅程' }));
    expect(document.getElementById('journeys')).toBeTruthy();
    expect(screen.getByRole('link', { name: '欢迎旅程' })).toBeTruthy();
  }, 15_000);

  it('非草稿活动仍可查看旅程，但不提供修改入口', async () => {
    const runningCampaign = { ...campaign, status: 'running' };
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/campaigns/${campaignId}`).reply(200, { data: runningCampaign });
    mock.onGet(`/campaigns/${campaignId}/journeys`).reply(200, listBody([journeyListItem]));
    renderApp();

    expect(await screen.findByRole('link', { name: '欢迎旅程' })).toBeTruthy();
    expect(screen.getByText('高价值会员')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '新建旅程' })).toBeNull();
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull();
  });
});
