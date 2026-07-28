import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const segment = {
  id: '2d4f4d57-9d59-4ed5-a2fa-d71733cebb60',
  name: '高价值会员',
  description: '用于列表说明',
  rules: {
    kind: 'all',
    children: [
      { kind: 'compare', left: { source: 'user', path: 'age' }, operator: 'gte', right: 30 },
    ],
  },
  updatedAt: '2026-07-19T00:00:00.000Z',
  audienceEstimate: {
    revision: 1,
    total: 2000,
    matched: 1240,
    calculatedAt: '2026-07-18T00:00:00.000Z',
    isStale: true,
  },
  journeyCount: 0,
};

function listBody(page = 1, pageSize = 10) {
  return {
    data: [segment],
    page: { page, pageSize, total: 21 },
  };
}

function detailBody() {
  return {
    ...segment,
    description: '用于操作列验证',
    revision: 1,
    createdAt: segment.updatedAt,
    createdBy: { id: account.id, displayName: account.displayName },
    updatedBy: { id: account.id, displayName: account.displayName },
  };
}

function renderApp(initialPath = '/segments') {
  mock.onGet(/\/segments\/[^/]+\/usages$/).reply(200, {
    data: [],
    page: { page: 1, pageSize: 10, total: 0 },
  });
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
  vi.restoreAllMocks();
  Modal.destroyAll();
});

describe('分群列表', () => {
  it('将预估、编辑和删除放在最右侧操作列', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/segments').reply(200, listBody());
    renderApp();

    expect(
      await screen.findByRole('button', { name: /^预\s*估$/ }, { timeout: 10_000 }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /^编\s*辑$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^删\s*除$/ })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '分群说明' })).toBeTruthy();
    expect(screen.getByText('用于列表说明')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').at(-1)?.textContent).toBe('操作');
  }, 30_000);

  it('通过列表操作列预估已保存分群并刷新人数', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/segments').replyOnce(200, listBody());
    mock.onGet('/segments').reply(200, {
      data: [
        {
          ...segment,
          audienceEstimate: {
            revision: 1,
            total: 2000,
            matched: 1200,
            calculatedAt: '2026-07-19T01:00:00.000Z',
            isStale: false,
          },
        },
      ],
      page: { page: 1, pageSize: 10, total: 21 },
    });
    mock.onGet(`/segments/${segment.id}`).reply(200, { data: detailBody() });
    mock.onPost('/segments/preview').reply(200, {
      data: {
        total: 2000,
        matched: 1200,
        calculatedAt: '2026-07-19T01:00:00.000Z',
        revision: 1,
      },
    });
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /^预\s*估$/ }, { timeout: 5_000 }));

    expect(await screen.findByText('1,200 / 2,000')).toBeTruthy();
    expect(await screen.findByText('预估完成，已更新最近预估人数')).toBeTruthy();
    expect(JSON.parse(String(mock.history.post[0]?.data))).toEqual({
      segmentId: segment.id,
      revision: 1,
    });
  });

  it('列表预估失败只通过消息提示', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/segments').reply(200, listBody());
    mock.onGet(`/segments/${segment.id}`).reply(200, { data: detailBody() });
    mock.onPost('/segments/preview').reply(500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: '计算失败，请稍后重试',
        requestId: 'test-request-id',
      },
    });
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /^预\s*估$/ }, { timeout: 5_000 }));

    expect(await screen.findByText('计算失败，请稍后重试')).toBeTruthy();
    expect(document.querySelector('.ant-alert')).toBeNull();
  });

  it('从列表操作列直接打开编辑抽屉', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/segments').reply(200, listBody());
    mock.onGet(`/segments/${segment.id}`).reply(200, { data: detailBody() });
    renderApp('/segments?q=vip');

    fireEvent.click(await screen.findByRole('button', { name: /^编\s*辑$/ }, { timeout: 5_000 }));

    const nameInput = await screen.findByPlaceholderText('请输入分群名称');
    expect((nameInput as HTMLInputElement).value).toBe('高价值会员');
  });

  it('确认后删除列表中的分群并重新读取列表', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/segments').replyOnce(200, listBody());
    mock.onGet('/segments').reply(200, { data: [], page: { page: 1, pageSize: 10, total: 0 } });
    mock.onDelete(`/segments/${segment.id}`).reply(204);
    renderApp();
    const confirmation = vi.spyOn(Modal, 'confirm');

    fireEvent.click(await screen.findByRole('button', { name: /^删\s*除$/ }, { timeout: 5_000 }));
    expect(confirmation).toHaveBeenCalledWith(
      expect.objectContaining({ title: '删除分群？', okText: '删除分群' }),
    );
    const onConfirm = confirmation.mock.calls[0]?.[0].onOk;
    await act(async () => {
      await onConfirm?.();
    });

    await waitFor(() => expect(screen.queryByRole('link', { name: '高价值会员' })).toBeNull());
    expect(mock.history.delete).toHaveLength(1);
    expect(await screen.findByText('暂无分群')).toBeTruthy();
  }, 10_000);

  it('分群存在引用旅程时禁用删除并给出查看入口', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/segments').reply(200, {
      data: [{ ...segment, journeyCount: 2 }],
      page: { page: 1, pageSize: 10, total: 1 },
    });
    renderApp();

    const nameLink = await screen.findByRole('link', { name: '高价值会员' }, { timeout: 5_000 });
    const row = nameLink.closest('tr')!;
    expect(within(row).getByText('2')).toBeTruthy();
    const deleteButton = within(row).getByRole('button', { name: /^删\s*除$/ });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.mouseEnter(deleteButton.parentElement!);
    const entry = await screen.findByRole('link', { name: '查看引用旅程' });
    expect(entry.parentElement?.textContent).toContain('该分群正在被旅程使用，请先更换或解除关联');
    expect(entry.getAttribute('href')).toBe(`/segments/${segment.id}#usages`);
    expect(mock.history.delete).toHaveLength(0);
  }, 15_000);

  it('详情页分群存在引用旅程时禁用删除并提供引用入口', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/segments/${segment.id}`).reply(200, {
      data: { ...detailBody(), journeyCount: 3 },
    });
    mock.onGet('/segments').reply(200, listBody());
    renderApp(`/segments/${segment.id}`);

    expect(await screen.findByText('用于操作列验证')).toBeTruthy();
    const deleteButton = screen.getByRole('button', { name: '删除分群' });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.mouseEnter(deleteButton.parentElement!);
    const entry = await screen.findByRole('link', { name: '查看引用旅程' });
    expect(entry.parentElement?.textContent).toContain('该分群正在被旅程使用，请先更换或解除关联');
    expect(entry.getAttribute('href')).toBe('#usages');
  }, 15_000);

  it('详情页确认删除后返回列表', async () => {
    const detail = {
      ...segment,
      description: '用于核对详情删除',
      revision: 1,
      createdAt: segment.updatedAt,
      createdBy: { id: account.id, displayName: account.displayName },
      updatedBy: { id: account.id, displayName: account.displayName },
    };
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/segments/${segment.id}`).reply(200, { data: detail });
    mock.onGet('/segments').reply(200, listBody());
    mock.onDelete(`/segments/${segment.id}`).reply(204);
    const router = renderApp(`/segments/${segment.id}`);
    const confirmation = vi.spyOn(Modal, 'confirm');

    try {
      expect(await screen.findByText('用于核对详情删除')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: '删除分群' }));
      expect(confirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '删除分群？',
          content: `确定删除“${segment.name}”分群吗？删除后无法恢复。`,
          okText: '删除分群',
        }),
      );

      await act(async () => {
        await confirmation.mock.calls[0]?.[0].onOk?.();
      });

      expect(mock.history.delete).toHaveLength(1);
      await waitFor(() => expect(router.state.location.pathname).toBe('/segments'));
    } finally {
      confirmation.mockRestore();
    }
  }, 15_000);

  it('从网址恢复搜索与分页，显示最近人数和过期提示', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/segments').replyOnce(200, listBody(2, 20));
    const router = renderApp('/segments?q=member&page=3&pageSize=20');

    expect(await screen.findByRole('link', { name: '高价值会员' })).toBeTruthy();
    expect(screen.getByText('1,240 / 2,000')).toBeTruthy();
    expect(screen.getByText('需要重新计算')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '分群' }).className).toContain(
      'ant-menu-item-selected',
    );
    expect((screen.getByLabelText('关键词') as HTMLInputElement).value).toBe('member');
    expect(mock.history.get.find((request) => request.url === '/segments')?.params).toEqual({
      q: 'member',
      page: 3,
      pageSize: 20,
    });

    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('page')).toBe('2'),
    );
    expect(new URLSearchParams(router.state.location.search).get('pageSize')).toBe('20');
  });

  it('网址中的非法每页条数给出明确提示并保留原网址', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    const router = renderApp('/segments?pageSize=17');

    expect(await screen.findByText('每页条数只能选择 10、20 或 50 条')).toBeTruthy();
    expect(router.state.location.search).toBe('?pageSize=17');
    expect(mock.history.get.filter((request) => request.url === '/segments')).toHaveLength(0);
  });

  it('详情返回入口保留当前搜索条件', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/segments').replyOnce(200, listBody(1));
    mock.onGet(`/segments/${segment.id}`).replyOnce(200, {
      data: {
        ...segment,
        description: '用于验证详情返回',
        revision: 1,
        createdAt: segment.updatedAt,
        createdBy: { id: account.id, displayName: account.displayName },
        updatedBy: { id: account.id, displayName: account.displayName },
      },
    });
    const router = renderApp('/segments?q=member');

    fireEvent.click(await screen.findByRole('link', { name: '高价值会员' }));
    expect(await screen.findByText('用于验证详情返回')).toBeTruthy();
    expect(screen.getByText('分群规则')).toBeTruthy();
    expect(screen.getByText('全部满足')).toBeTruthy();
    expect(screen.getByText('年龄')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回分群列表' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/segments'));
    expect(router.state.location.search).toBe('?q=member');
  });

  it('分群引用列表显示旅程并保留来源网址返回', async () => {
    const journeyId = '88a0f727-a226-4cb4-9495-74364f8d0e33';
    const campaignId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb60';
    const journey = {
      id: journeyId,
      name: '欢迎旅程',
      description: null,
      revision: 1,
      campaign: { id: campaignId, name: '春季活动', status: 'paused' },
      segment: { id: segment.id, name: segment.name, revision: 1, rules: segment.rules },
      draftDefinition: null,
      createdAt: segment.updatedAt,
      updatedAt: segment.updatedAt,
      createdBy: { id: account.id, displayName: account.displayName },
      updatedBy: { id: account.id, displayName: account.displayName },
    };
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/segments').reply(200, listBody());
    mock.onGet(`/segments/${segment.id}`).reply(200, { data: detailBody() });
    mock.onGet(`/segments/${segment.id}/usages`).reply((config) => {
      const page = Number(config.params?.page ?? 1);
      const pageSize = Number(config.params?.pageSize ?? 10);
      return [
        200,
        {
          data: [
            {
              journey: { id: journeyId, name: journey.name },
              campaign: journey.campaign,
              updatedAt: journey.updatedAt,
            },
          ],
          page: {
            page: page === 3 && pageSize === 20 ? 2 : page,
            pageSize,
            total: 21,
          },
        },
      ];
    });
    mock.onGet(`/journeys/${journeyId}`).reply(200, { data: journey });
    const router = renderApp('/segments?q=member');

    fireEvent.click(await screen.findByRole('link', { name: '高价值会员' }));
    expect(await screen.findByText('用于操作列验证')).toBeTruthy();
    await router.navigate(`/segments/${segment.id}?page=3&pageSize=20`, {
      state: { returnTo: '?q=member' },
    });
    expect(await screen.findByRole('link', { name: '欢迎旅程' })).toBeTruthy();
    // 引用列表直接展示活动状态，暂停是共享契约中的正常值。
    expect(screen.getByText('已暂停')).toBeTruthy();
    await waitFor(() => expect(router.state.location.search).toBe('?page=2&pageSize=20'));
    // 等页面按修正后的网址重新渲染，旅程链接携带的返回地址才与当前页码一致。
    await act(async () => {});
    expect(router.state.location.state).toEqual({ returnTo: '?q=member' });
    await waitFor(() =>
      expect(screen.getByRole('listitem', { name: '2' }).className).toContain(
        'ant-pagination-item-active',
      ),
    );
    fireEvent.click(screen.getByRole('link', { name: '欢迎旅程' }));
    expect(router.state.location.state).toEqual({
      returnTo: `/segments/${segment.id}?page=2&pageSize=20#usages`,
      returnState: { returnTo: '?q=member' },
    });
    expect(await screen.findByText('所属活动')).toBeTruthy();
    expect(screen.getByRole('link', { name: '春季活动' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/segments/${segment.id}`);
      expect(router.state.location.search).toBe('?page=2&pageSize=20');
      expect(router.state.location.state).toEqual({ returnTo: '?q=member' });
    });
    fireEvent.click(screen.getByRole('button', { name: '返回分群列表' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/segments');
      expect(router.state.location.search).toBe('?q=member');
    });
  }, 15_000);

  it('从分群列表删除受阻时提供引用入口', async () => {
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet('/segments').reply(200, listBody());
    mock.onGet(`/segments/${segment.id}`).reply(200, { data: detailBody() });
    mock.onGet(`/segments/${segment.id}/usages`).reply(200, {
      data: [],
      page: { page: 1, pageSize: 10, total: 0 },
    });
    mock.onDelete(`/segments/${segment.id}`).reply(409, {
      error: {
        code: 'SEGMENT_IN_USE',
        message: '分群正在被旅程使用，请先更换或解除关联',
        requestId: 'test-request-id',
      },
    });
    const router = renderApp('/segments');
    const confirmation = vi.spyOn(Modal, 'confirm');

    try {
      fireEvent.click(await screen.findByRole('button', { name: /^删\s*除$/ }, { timeout: 5_000 }));
      await act(async () => {
        await confirmation.mock.calls[0]?.[0].onOk?.();
      });

      expect(await screen.findByText('分群正在被旅程使用，请先更换或解除关联')).toBeTruthy();
      fireEvent.click(screen.getByRole('link', { name: '查看引用' }));
      expect(await screen.findByText('引用旅程')).toBeTruthy();
      await waitFor(() => expect(router.state.location.pathname).toBe(`/segments/${segment.id}`));
      expect(router.state.location.hash).toBe('#usages');
    } finally {
      confirmation.mockRestore();
    }
  }, 15_000);

  it('已保存分群明确重新计算后展示最近人数', async () => {
    const detail = {
      ...segment,
      description: '用于核对最近人数',
      revision: 1,
      createdAt: segment.updatedAt,
      createdBy: { id: account.id, displayName: account.displayName },
      updatedBy: { id: account.id, displayName: account.displayName },
    };
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/segments/${segment.id}`).reply(200, { data: detail });
    mock.onPost('/segments/preview').replyOnce(200, {
      data: { total: 2000, matched: 1240, calculatedAt: '2026-07-19T01:00:00.000Z', revision: 1 },
    });
    renderApp(`/segments/${segment.id}`);

    expect(await screen.findByText('用于核对最近人数')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '预估人数' }));

    expect(await screen.findByText('1,240')).toBeTruthy();
    expect(await screen.findByText('预估完成，已更新最近预估人数')).toBeTruthy();
    expect(JSON.parse(String(mock.history.post[0]?.data))).toEqual({
      segmentId: segment.id,
      revision: 1,
    });
  });

  it('详情页预估失败只通过消息提示', async () => {
    const detail = {
      ...segment,
      description: '用于核对预估失败',
      revision: 1,
      createdAt: segment.updatedAt,
      createdBy: { id: account.id, displayName: account.displayName },
      updatedBy: { id: account.id, displayName: account.displayName },
    };
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/segments/${segment.id}`).reply(200, { data: detail });
    mock.onPost('/segments/preview').reply(500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: '计算失败，请稍后重试',
        requestId: 'test-request-id',
      },
    });
    renderApp(`/segments/${segment.id}`);

    expect(await screen.findByText('用于核对预估失败')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '预估人数' }));

    expect(await screen.findByText('计算失败，请稍后重试')).toBeTruthy();
    expect(document.querySelector('.ant-alert')).toBeNull();
  });

  it('预估遇到修订冲突后重新读取最新分群，再由用户主动预估', async () => {
    const detail = {
      ...segment,
      description: '用于核对冲突处理',
      revision: 1,
      createdAt: segment.updatedAt,
      createdBy: { id: account.id, displayName: account.displayName },
      updatedBy: { id: account.id, displayName: account.displayName },
    };
    const latest = { ...detail, name: '高价值会员（最新）', revision: 2 };
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/segments/${segment.id}`).replyOnce(200, { data: detail });
    mock.onGet(`/segments/${segment.id}`).replyOnce(200, { data: latest });
    mock.onPost('/segments/preview').replyOnce(409, {
      error: {
        code: 'SEGMENT_REVISION_CONFLICT',
        message: '分群已被修改，请重新读取后再保存',
        requestId: 'test-request-id',
      },
    });
    mock.onPost('/segments/preview').replyOnce(200, {
      data: {
        total: 2000,
        matched: 1500,
        calculatedAt: '2026-07-19T02:00:00.000Z',
        revision: 2,
      },
    });
    renderApp(`/segments/${segment.id}`);

    expect(await screen.findByText('用于核对冲突处理')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '预估人数' }));

    expect(await screen.findByText('分群已被修改，请重新读取最新规则后再预估。')).toBeTruthy();
    const reloadButton = screen.getByRole('button', { name: '重新读取' });
    expect(mock.history.post).toHaveLength(1);

    fireEvent.click(reloadButton);
    expect(await screen.findByRole('heading', { name: latest.name })).toBeTruthy();
    expect(screen.queryByText('分群已被修改，请重新读取最新规则后再预估。')).toBeNull();
    expect(mock.history.post).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '预估人数' }));
    expect(await screen.findByText('1,500')).toBeTruthy();
    expect(JSON.parse(String(mock.history.post[1]?.data))).toEqual({
      segmentId: segment.id,
      revision: 2,
    });
  }, 15_000);

  it('修订冲突后读取失败时明确提示并保留重新读取入口', async () => {
    const detail = {
      ...segment,
      description: '用于核对读取失败',
      revision: 1,
      createdAt: segment.updatedAt,
      createdBy: { id: account.id, displayName: account.displayName },
      updatedBy: { id: account.id, displayName: account.displayName },
    };
    const latest = { ...detail, name: '高价值会员（已刷新）', revision: 2 };
    mock.onGet('/userinfo').reply(200, { data: account });
    mock.onGet(`/segments/${segment.id}`).replyOnce(200, { data: detail });
    mock.onGet(`/segments/${segment.id}`).replyOnce(500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务暂时不可用',
        requestId: 'test-request-id',
      },
    });
    mock.onGet(`/segments/${segment.id}`).replyOnce(200, { data: latest });
    mock.onPost('/segments/preview').replyOnce(409, {
      error: {
        code: 'SEGMENT_REVISION_CONFLICT',
        message: '分群已被修改，请重新读取后再保存',
        requestId: 'test-request-id',
      },
    });
    renderApp(`/segments/${segment.id}`);

    expect(await screen.findByText('用于核对读取失败')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '预估人数' }));
    expect(await screen.findByText('分群已被修改，请重新读取最新规则后再预估。')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    expect(await screen.findByText('暂时无法读取最新分群，请稍后重试。')).toBeTruthy();
    const reloadAgain = screen.getByRole('button', { name: '重新读取' });

    fireEvent.click(reloadAgain);
    expect(await screen.findByRole('heading', { name: latest.name })).toBeTruthy();
    expect(screen.queryByText('暂时无法读取最新分群，请稍后重试。')).toBeNull();
    expect(screen.queryByText('分群已被修改，请重新读取最新规则后再预估。')).toBeNull();
  }, 15_000);
});
