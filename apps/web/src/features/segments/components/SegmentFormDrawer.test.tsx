import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { SegmentDetail, SegmentRule } from '@journeylens/shared';
import { AuthProvider } from '@/features/auth/auth-provider';
import { QueryProvider } from '@/app/QueryProvider';
import { apiClient } from '@/services/api';
import { appRoutes } from '@/app/router';
import { segmentQueryKeys } from '@/features/segments/segment-queries';

let mock: MockAdapter;
let queryClient: QueryClient | undefined;

const account = {
  id: 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120',
  email: 'operator@example.com',
  displayName: 'JourneyLens 管理员',
};
const segmentId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb60';
const rule: SegmentRule = {
  kind: 'all',
  children: [
    {
      kind: 'compare',
      left: { source: 'user', path: 'displayName' },
      operator: 'eq',
      right: '会员A',
    },
  ],
};

function detail(name: string, audienceEstimate: SegmentDetail['audienceEstimate'] = null) {
  return {
    id: segmentId,
    name,
    description: null,
    rules: rule,
    revision: 1,
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
    createdBy: { id: account.id, displayName: account.displayName },
    updatedBy: { id: account.id, displayName: account.displayName },
    audienceEstimate,
    journeyCount: 0,
  };
}

function listBody(data: unknown[] = []) {
  return { data, page: { page: 1, pageSize: 10, total: data.length } };
}

function renderApp(initialPath = '/segments') {
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
  mock.onGet('/userinfo').reply(200, { data: account });
});

afterEach(() => {
  cleanup();
  queryClient?.clear();
  queryClient = undefined;
  mock.restore();
});

describe('分群表单抽屉', () => {
  it('在列表中新建，自动试算后保存并留在列表', async () => {
    const saved = detail('会员试算组');
    const estimate = {
      revision: saved.revision,
      total: 2,
      matched: 1,
      calculatedAt: '2026-07-19T00:02:00.000Z',
    };
    const summary = {
      id: segmentId,
      name: saved.name,
      description: null,
      rules: rule,
      updatedAt: saved.updatedAt,
      audienceEstimate: { ...estimate, isStale: false },
      journeyCount: 0,
    };
    mock.onGet('/segments').replyOnce(200, listBody());
    mock.onGet('/segments').replyOnce(200, listBody([summary]));
    mock.onPost('/segments/preview').replyOnce(200, {
      data: { total: 2, matched: 1, calculatedAt: '2026-07-19T00:01:00.000Z' },
    });
    mock.onPost('/segments/preview').replyOnce(200, { data: estimate });
    mock.onPost('/segments').replyOnce(201, { data: saved });
    const router = renderApp();

    expect(await screen.findByText('暂无分群')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /新建分群/ }));
    fireEvent.change(await screen.findByLabelText('分群名称'), { target: { value: '会员试算组' } });
    fireEvent.click(screen.getByRole('button', { name: /添加条件$/ }));
    fireEvent.change(screen.getByLabelText('条件 1比较值'), { target: { value: '会员A' } });

    const previewLabel = await screen.findByText('预计匹配', {}, { timeout: 5_000 });
    const previewStatus = previewLabel.closest('[role="status"]');
    expect(previewStatus?.textContent).toContain('1');
    expect(previewStatus?.textContent).toContain('50.0%');
    expect(screen.queryByRole('button', { name: '手动试算' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '创建分群' }));

    const confirmationTitle = await screen.findByText('确认创建分群');
    expect(confirmationTitle).toBeTruthy();
    const confirmation = screen.getAllByRole('dialog').at(-1)!;
    expect(within(confirmation).getByText('分群名称')).toBeTruthy();
    expect(within(confirmation).getByText('会员试算组')).toBeTruthy();
    expect(within(confirmation).getByText('分群说明')).toBeTruthy();
    expect(within(confirmation).getByText('—')).toBeTruthy();
    expect(within(confirmation).getByText('规则条件')).toBeTruthy();
    expect(within(confirmation).getByText('昵称')).toBeTruthy();
    expect(within(confirmation).getByText('会员A')).toBeTruthy();
    expect(within(confirmation).getByText(/预计匹配 1 人，约占全部用户 50\.0%/)).toBeTruthy();
    expect(mock.history.post.filter((request) => request.url === '/segments')).toHaveLength(0);
    fireEvent.click(within(confirmation).getByRole('button', { name: '返回修改' }));
    expect((screen.getByLabelText('分群名称') as HTMLInputElement).value).toBe('会员试算组');
    fireEvent.click(screen.getByRole('button', { name: '创建分群' }));
    const nextConfirmationTitle = await screen.findByText('确认创建分群');
    expect(nextConfirmationTitle).toBeTruthy();
    const nextConfirmation = screen.getAllByRole('dialog').at(-1)!;
    fireEvent.click(within(nextConfirmation).getByRole('button', { name: '确认创建' }));

    const cachedLists = () =>
      queryClient?.getQueriesData<{
        data: Array<{ audienceEstimate: { matched: number } | null }>;
      }>({ queryKey: segmentQueryKeys.lists }) ?? [];
    await waitFor(() => {
      expect(
        cachedLists().some(([, data]) =>
          data?.data.some((item) => item.audienceEstimate?.matched === 1),
        ),
      ).toBe(true);
    });
    expect(document.body.textContent).toContain('1 / 2');
    expect(router.state.location.pathname).toBe('/segments');
    expect(document.querySelector('#name')).toBeNull();
    const previews = mock.history.post.filter((request) => request.url === '/segments/preview');
    const create = mock.history.post.find((request) => request.url === '/segments');
    expect(JSON.parse(String(previews[0]?.data))).toEqual({ rules: rule });
    expect(JSON.parse(String(previews[1]?.data))).toEqual({ segmentId, revision: saved.revision });
    expect(JSON.parse(String(create?.data))).toEqual({
      name: '会员试算组',
      description: null,
      rules: rule,
    });
    expect(saved.audienceEstimate).toBeNull();
  }, 20_000);

  it('编辑保存后自动刷新已保存人数并清除过期提示', async () => {
    const existing = detail('会员试算组', {
      revision: 1,
      total: 2,
      matched: 2,
      calculatedAt: '2026-07-18T00:00:00.000Z',
      isStale: false,
    });
    const updated = {
      ...existing,
      name: '会员试算组（已修改）',
      revision: 2,
      updatedAt: '2026-07-19T00:02:00.000Z',
      audienceEstimate: { ...existing.audienceEstimate!, isStale: true },
    };
    const estimate = {
      revision: updated.revision,
      total: 2,
      matched: 1,
      calculatedAt: '2026-07-19T00:03:00.000Z',
    };
    mock.onGet(`/segments/${segmentId}`).replyOnce(200, { data: existing });
    mock.onPost('/segments/preview').replyOnce(200, {
      data: { total: 2, matched: 2, calculatedAt: '2026-07-19T00:01:00.000Z' },
    });
    mock.onPatch(`/segments/${segmentId}`).replyOnce(200, { data: updated });
    mock.onPost('/segments/preview').replyOnce(200, { data: estimate });
    const router = renderApp(`/segments/${segmentId}`);

    expect(await screen.findByRole('heading', { name: '会员试算组' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑分群' }));
    await screen.findByText('预计匹配', {}, { timeout: 5_000 });
    fireEvent.change(await screen.findByLabelText('分群名称'), {
      target: { value: updated.name },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByRole('heading', { name: updated.name })).toBeTruthy();
    const estimateSection = screen.getByText('最近预估人数').parentElement;
    expect(estimateSection).not.toBeNull();
    expect(within(estimateSection!).getByText('1')).toBeTruthy();
    expect(screen.queryByText('需要重新计算')).toBeNull();
    expect(router.state.location.pathname).toBe(`/segments/${segmentId}`);
    const refreshRequest = mock.history.post.find(
      (request) =>
        request.url === '/segments/preview' && JSON.parse(String(request.data)).segmentId,
    );
    expect(JSON.parse(String(refreshRequest?.data))).toEqual({
      segmentId,
      revision: updated.revision,
    });
  }, 10_000);

  it('编辑期间后台刷新不改变提交内容对应的版本号', async () => {
    const existing = detail('会员试算组', {
      revision: 1,
      total: 2,
      matched: 2,
      calculatedAt: '2026-07-18T00:00:00.000Z',
      isStale: false,
    });
    const latest = {
      ...existing,
      name: '他人修改后的分群',
      revision: 2,
      updatedAt: '2026-07-19T00:05:00.000Z',
    };
    mock.onGet(`/segments/${segmentId}`).replyOnce(200, { data: existing });
    mock.onGet(`/segments/${segmentId}`).replyOnce(200, { data: latest });
    mock.onPost('/segments/preview').reply(200, {
      data: { total: 2, matched: 2, calculatedAt: '2026-07-19T00:01:00.000Z' },
    });
    mock.onPatch(`/segments/${segmentId}`).replyOnce(409, {
      error: {
        code: 'SEGMENT_REVISION_CONFLICT',
        message: '分群已被修改，请重新读取后再保存',
        requestId: 'test-request-id',
      },
    });
    renderApp(`/segments/${segmentId}`);

    expect(await screen.findByRole('heading', { name: existing.name })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑分群' }));
    expect(((await screen.findByLabelText('分群名称')) as HTMLInputElement).value).toBe(
      existing.name,
    );

    await act(async () => {
      await queryClient?.refetchQueries({ queryKey: segmentQueryKeys.detail(segmentId) });
    });
    expect(await screen.findByRole('heading', { name: latest.name })).toBeTruthy();
    expect((screen.getByLabelText('分群名称') as HTMLInputElement).value).toBe(existing.name);

    fireEvent.change(screen.getByLabelText('分群名称'), {
      target: { value: '本地修改后的分群' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByText('分群已被修改，请重新读取后再保存')).toBeTruthy();
    expect((screen.getByLabelText('分群名称') as HTMLInputElement).value).toBe('本地修改后的分群');
    const patch = mock.history.patch.find((request) => request.url === `/segments/${segmentId}`);
    expect(JSON.parse(String(patch?.data))).toMatchObject({
      name: '本地修改后的分群',
      revision: 1,
    });
  }, 10_000);

  it('自动预估遇到登录失效后结束等待并进入登录页', async () => {
    const existing = detail('会员试算组');
    mock.onGet(`/segments/${segmentId}`).replyOnce(200, { data: existing });
    mock.onPost('/segments/preview').replyOnce(401, {
      error: { code: 'AUTH_REQUIRED', message: '需要登录', requestId: 'test-request-id' },
    });
    const router = renderApp(`/segments/${segmentId}`);

    expect(await screen.findByRole('heading', { name: existing.name })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑分群' }));

    expect(
      await screen.findByRole('heading', { name: '登录 JourneyLens' }, { timeout: 5_000 }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByText('正在预估…')).toBeNull();
    expect(screen.queryByText('需要登录')).toBeNull();
  }, 10_000);

  it('人数更新失败时仍完成创建并提示可手动重试', async () => {
    const saved = detail('预估待重试分群');
    const summary = {
      id: saved.id,
      name: saved.name,
      description: null,
      rules: saved.rules,
      updatedAt: saved.updatedAt,
      audienceEstimate: null,
      journeyCount: 0,
    };
    mock.onGet('/segments').replyOnce(200, listBody());
    mock.onGet('/segments').replyOnce(200, listBody([summary]));
    mock.onPost('/segments/preview').replyOnce(200, {
      data: { total: 2, matched: 1, calculatedAt: '2026-07-19T00:01:00.000Z' },
    });
    mock.onPost('/segments').replyOnce(201, { data: saved });
    mock.onPost('/segments/preview').replyOnce(500, {
      error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId: 'test-request-id' },
    });
    renderApp();

    await screen.findByText('暂无分群');
    fireEvent.click(screen.getByRole('button', { name: /新建分群/ }));
    fireEvent.change(await screen.findByLabelText('分群名称'), {
      target: { value: saved.name },
    });
    fireEvent.click(screen.getByRole('button', { name: /添加条件$/ }));
    fireEvent.change(screen.getByLabelText('条件 1比较值'), { target: { value: '会员A' } });
    await screen.findByText('预计匹配', {}, { timeout: 5_000 });
    fireEvent.click(screen.getByRole('button', { name: '创建分群' }));
    await screen.findByText('确认创建分群');
    const confirmation = screen.getAllByRole('dialog').at(-1)!;
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认创建' }));

    expect(await screen.findByRole('link', { name: saved.name })).toBeTruthy();
    expect(
      screen.getByText('分群已保存，但预估人数未更新。可在操作列点击“预估”重试。'),
    ).toBeTruthy();
    expect(screen.getByText('尚未计算')).toBeTruthy();
    expect(screen.queryByLabelText('分群名称')).toBeNull();
  }, 10_000);

  it('创建确认预览期间离开仍提示放弃，并保留抽屉输入', async () => {
    mock.onGet('/segments').reply(200, listBody());
    mock.onPost('/segments/preview').reply(200, {
      data: { total: 2, matched: 1, calculatedAt: '2026-07-19T00:01:00.000Z' },
    });
    const router = renderApp();

    await screen.findByText('暂无分群');
    fireEvent.click(screen.getByRole('button', { name: /新建分群/ }));
    fireEvent.change(await screen.findByLabelText('分群名称'), {
      target: { value: '待确认分群' },
    });
    fireEvent.click(screen.getByRole('button', { name: /添加条件$/ }));
    fireEvent.change(screen.getByLabelText('条件 1比较值'), { target: { value: '演示用户' } });
    fireEvent.click(screen.getByRole('button', { name: '创建分群' }));
    await screen.findByText('确认创建分群');

    await act(async () => {
      await router.navigate('/campaigns');
    });

    expect(await screen.findByText('已填写的内容不会保存。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认创建' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect((screen.getByLabelText('分群名称') as HTMLInputElement).value).toBe('待确认分群');
    expect(router.state.location.pathname).toBe('/segments');
  }, 15_000);

  it('编辑时的临时试算不覆盖详情中的已保存人数', async () => {
    const saved = detail('会员试算组', {
      revision: 1,
      total: 2,
      matched: 2,
      calculatedAt: '2026-07-18T00:00:00.000Z',
      isStale: false,
    });
    mock.onGet(`/segments/${segmentId}`).reply(200, { data: saved });
    mock.onPost('/segments/preview').replyOnce(200, {
      data: { total: 2, matched: 0, calculatedAt: '2026-07-19T00:01:00.000Z' },
    });
    const router = renderApp(`/segments/${segmentId}`);

    expect(await screen.findByRole('heading', { name: '会员试算组' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑分群' }));
    const previewLabel = await screen.findByText('预计匹配', {}, { timeout: 5_000 });
    const preview = previewLabel.closest('[role="status"]');
    expect(preview?.textContent).toContain('0');
    expect(preview?.textContent).toContain('0.0%');
    expect(screen.queryByRole('button', { name: '手动试算' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));

    await waitFor(() => expect(screen.queryByLabelText('分群名称')).toBeNull());
    const savedEstimateSection = screen.getByText('最近预估人数').parentElement;
    expect(savedEstimateSection).not.toBeNull();
    expect(within(savedEstimateSection!).getByText('2')).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/segments/${segmentId}`);
    expect(mock.history.post).toHaveLength(1);
    expect(JSON.parse(String(mock.history.post[0]?.data))).toEqual({ rules: rule });
  }, 10_000);

  it('保存失败时保留抽屉中的输入', async () => {
    mock.onGet('/segments').reply(200, listBody());
    mock.onPost('/segments/preview').reply(200, {
      data: { total: 2, matched: 1, calculatedAt: '2026-07-19T00:01:00.000Z' },
    });
    mock.onPost('/segments').replyOnce(500, {
      error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId: 'test-request-id' },
    });
    renderApp();

    await screen.findByText('暂无分群');
    fireEvent.click(screen.getByRole('button', { name: /新建分群/ }));
    fireEvent.change(await screen.findByLabelText('分群名称'), { target: { value: '待保存分群' } });
    fireEvent.click(screen.getByRole('button', { name: /添加条件$/ }));
    fireEvent.change(screen.getByLabelText('条件 1比较值'), { target: { value: '会员A' } });
    fireEvent.click(screen.getByRole('button', { name: '创建分群' }));
    const confirmationTitle = await screen.findByText('确认创建分群');
    expect(confirmationTitle).toBeTruthy();
    const confirmation = screen.getAllByRole('dialog').at(-1)!;
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认创建' }));

    expect(await screen.findByText('服务暂时不可用')).toBeTruthy();
    expect((screen.getByLabelText('分群名称') as HTMLInputElement).value).toBe('待保存分群');
    expect(screen.getByRole('dialog')).toBeTruthy();
  }, 10_000);

  it('关闭未保存抽屉前确认，取消放弃会保留输入，放弃后焦点回到新建入口', async () => {
    mock.onGet('/segments').reply(200, listBody());
    const router = renderApp();
    await screen.findByText('暂无分群');
    const createButton = screen.getByRole('button', { name: /新建分群/ });
    fireEvent.click(createButton);
    fireEvent.change(await screen.findByLabelText('分群名称'), { target: { value: '待放弃分群' } });

    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(await screen.findByText('已填写的内容不会保存。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect((screen.getByLabelText('分群名称') as HTMLInputElement).value).toBe('待放弃分群');

    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃填写' }));
    await waitFor(() => expect(screen.queryByLabelText('分群名称')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(createButton));
    expect(router.state.location.pathname).toBe('/segments');
  }, 10_000);
});
