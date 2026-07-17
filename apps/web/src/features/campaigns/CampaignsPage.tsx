import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Col,
  Empty,
  Flex,
  Form,
  Input,
  Pagination,
  Select,
  Table,
} from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import type { TableProps } from 'antd';
import {
  CAMPAIGN_STATUSES,
  PAGE_SIZES,
  type CampaignListQueryInput,
  type CampaignStatus,
  type CampaignSummary,
} from '@journeylens/shared';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { getApiErrorMessage, isSessionExpired } from '@/services/api';
import { getCampaigns } from '@/services/campaigns';
import { ListFilterBar } from '@/components/ListFilterBar';
import { ListPageLayout } from '@/components/ListPageLayout';
import { PageHeader } from '@/components/PageHeader';
import { campaignQueryKeys } from './campaign-queries';
import { campaignStatusBadges, campaignStatusLabels } from './campaign-status';
import { CampaignFormDrawer } from './components/CampaignFormDrawer';

type RefreshNotice = 'created' | 'deleted';

type FilterValues = {
  q?: string;
  status?: CampaignStatus | 'all';
};

const statusOptions = [
  { label: '全部', value: 'all' },
  ...CAMPAIGN_STATUSES.map((status) => ({ label: campaignStatusLabels[status], value: status })),
];

const filterCol = { xs: 24, sm: 12, lg: 8, xl: 6 };

function getCampaignColumns(search: string): NonNullable<TableProps<CampaignSummary>['columns']> {
  return [
    {
      title: '活动名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, campaign) => (
        <Link
          to={`/campaigns/${campaign.id}`}
          state={{ returnTo: search }}
          style={{ fontWeight: 600 }}
        >
          {name}
        </Link>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: CampaignStatus) => (
        <Badge status={campaignStatusBadges[status]} text={campaignStatusLabels[status]} />
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (updatedAt: string) => new Date(updatedAt).toLocaleString('zh-CN'),
    },
  ];
}

export function CampaignsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<RefreshNotice | undefined>(
    location.state === 'campaign-deleted' ? 'deleted' : undefined,
  );
  const [form] = Form.useForm<FilterValues>();
  const query = searchParams.get('q') ?? '';
  const rawStatus = searchParams.get('status');
  const status = CAMPAIGN_STATUSES.find((value) => value === rawStatus) ?? 'all';
  const rawPage = searchParams.get('page');
  const rawPageSize = searchParams.get('pageSize');
  const page = rawPage === null ? 1 : Number(rawPage);
  const pageSize = rawPageSize === '20' ? 20 : rawPageSize === '50' ? 50 : 10;

  // 保留网址中的原始分页参数，由 service 校验；非法值要明确报错，不能静默改成默认值。
  const queryInput: CampaignListQueryInput = {
    q: query || undefined,
    status: status === 'all' ? undefined : status,
    page: rawPage ?? undefined,
    pageSize: rawPageSize ?? undefined,
  };
  const listQuery = useQuery({
    queryKey: campaignQueryKeys.list(queryInput),
    queryFn: ({ signal }) => getCampaigns(queryInput, signal),
  });
  const list = listQuery.data;

  // 网址变化（从详情返回、浏览器前进后退）时回填筛选表单；编辑表单不写网址。
  useEffect(() => {
    form.setFieldsValue({ q: query, status });
  }, [form, query, status]);

  useEffect(() => {
    if (location.state !== 'campaign-deleted') return;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate]);

  // 后端返回的有效页码与网址不同时，等本次读取完成再回写网址，避免依据旧缓存跳页。
  const serverPage = list?.page.page;
  useEffect(() => {
    if (serverPage === undefined || listQuery.isFetching || listQuery.isRefetchError) return;
    if (!listQuery.isFetchedAfterMount || serverPage === page) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (serverPage === 1) next.delete('page');
        else next.set('page', String(serverPage));
        return next;
      },
      { replace: true },
    );
  }, [
    listQuery.isFetchedAfterMount,
    listQuery.isFetching,
    listQuery.isRefetchError,
    page,
    serverPage,
    setSearchParams,
  ]);

  // 写后刷新提示在列表成功读取后清除，读取失败时保留具体原因。
  useEffect(() => {
    if (refreshNotice === undefined) return;
    if (listQuery.isSuccess && !listQuery.isFetching && listQuery.error === null) {
      setRefreshNotice(undefined);
    }
  }, [listQuery.error, listQuery.isFetching, listQuery.isSuccess, refreshNotice]);

  const loadError =
    listQuery.error !== null && !isSessionExpired(listQuery.error)
      ? refreshNotice === 'created'
        ? '活动已创建，列表暂时无法刷新'
        : refreshNotice === 'deleted'
          ? '活动已删除，列表暂时无法刷新'
          : getApiErrorMessage(listQuery.error)
      : undefined;

  async function refreshAfterCreate(): Promise<void> {
    try {
      await listQuery.refetch({ throwOnError: true });
    } catch (error) {
      if (!isSessionExpired(error)) setRefreshNotice('created');
    }
  }

  function handleCreated(): void {
    setCreateOpen(false);
    if (page === 1) {
      void refreshAfterCreate();
      return;
    }
    setRefreshNotice('created');
    setPagination(1, pageSize);
  }

  function applyFilters(values: FilterValues): void {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      const keyword = values.q?.trim() ?? '';
      if (keyword) next.set('q', keyword);
      else next.delete('q');
      if (!values.status || values.status === 'all') next.delete('status');
      else next.set('status', values.status);
      next.delete('page');
      return next;
    });
  }

  function setPagination(nextPage: number, nextPageSize: number): void {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      const pageSizeChanged = nextPageSize !== pageSize;
      if (nextPageSize === 10) next.delete('pageSize');
      else next.set('pageSize', String(nextPageSize));
      if (pageSizeChanged || nextPage === 1) next.delete('page');
      else next.set('page', String(nextPage));
      return next;
    });
  }

  function resetFilters(): void {
    form.setFieldsValue({ q: '', status: 'all' });
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('q');
      next.delete('status');
      next.delete('page');
      return next;
    });
  }

  const listHasNoMatch = query !== '' || status !== 'all';

  return (
    <section aria-label="全部活动">
      <Flex vertical gap={16} style={{ maxWidth: 1560, margin: '0 auto' }}>
        <PageHeader
          title="活动"
          actions={
            <Button
              ref={createButtonRef}
              type="primary"
              size="large"
              onClick={() => setCreateOpen(true)}
              icon={<PlusOutlined />}
            >
              新建活动
            </Button>
          }
        />
        <ListPageLayout
          loading={list === undefined && listQuery.isPending}
          loadingLabel="正在读取活动"
          filters={
            <ListFilterBar form={form} onSearch={applyFilters} onReset={resetFilters}>
              <Col {...filterCol}>
                <Form.Item name="q" label="关键词">
                  <Input
                    allowClear
                    maxLength={180}
                    placeholder="搜索活动名称或描述"
                    prefix={<SearchOutlined aria-hidden="true" />}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col {...filterCol}>
                <Form.Item name="status" label="状态">
                  <Select allowClear options={statusOptions} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </ListFilterBar>
          }
          footer={
            list !== undefined && (
              <Pagination
                current={list.page.page}
                pageSize={list.page.pageSize}
                total={list.page.total}
                showSizeChanger={{ id: 'campaign-page-size', 'aria-label': '每页条数' }}
                pageSizeOptions={[...PAGE_SIZES]}
                showQuickJumper
                disabled={listQuery.isFetching}
                showTotal={(total) => `共 ${total} 条`}
                onChange={setPagination}
              />
            )
          }
        >
          {loadError && (
            <Alert
              style={{ marginBottom: 16 }}
              type="error"
              showIcon
              title={loadError}
              action={
                <Button type="link" onClick={() => void listQuery.refetch()}>
                  重试
                </Button>
              }
            />
          )}

          {list !== undefined && (
            <Table<CampaignSummary>
              rowKey="id"
              columns={getCampaignColumns(location.search)}
              dataSource={list.data}
              pagination={false}
              size="middle"
              loading={listQuery.isFetching}
              locale={{
                emptyText: loadError ? null : (
                  <Empty description={listHasNoMatch ? '没有符合条件的活动' : '暂无活动'} />
                ),
              }}
            />
          )}
        </ListPageLayout>
      </Flex>

      <CampaignFormDrawer
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onSaved={handleCreated}
        restoreFocus={() => createButtonRef.current?.focus()}
      />
    </section>
  );
}
