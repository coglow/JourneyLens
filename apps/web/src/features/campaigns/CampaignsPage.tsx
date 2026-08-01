import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Col,
  Divider,
  Empty,
  Flex,
  Form,
  Input,
  Pagination,
  Popconfirm,
  Select,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import type { TableProps } from 'antd';
import {
  CAMPAIGN_STATUSES,
  PAGE_SIZES,
  canEditCampaign,
  type CampaignListQueryInput,
  type CampaignDetail,
  type CampaignStatus,
  type CampaignListItem,
} from '@journeylens/shared';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  ApiError,
  getApiErrorMessage,
  getWriteErrorMessage,
  isSessionExpired,
} from '@/services/api';
import { deleteCampaign, getCampaign, getCampaigns } from '@/services/campaigns';
import { ListFilterBar, listFilterColProps } from '@/components/ListFilterBar';
import { ListPageLayout } from '@/components/ListPageLayout';
import { PageHeader } from '@/components/PageHeader';
import { useListPagination, useSyncListPage } from '@/hooks/use-list-pagination';
import { formatDateTime } from '@/utils/format-date-time';
import { campaignQueryKeys } from './campaign-queries';
import { campaignStatusBadges, campaignStatusLabels } from './campaign-status';
import { CampaignFormDrawer } from './components/CampaignFormDrawer';

type RefreshNotice = 'created' | 'saved' | 'deleted';

type FilterValues = {
  q?: string;
  status?: CampaignStatus | 'all';
};

const statusOptions = [
  { label: '全部', value: 'all' },
  ...CAMPAIGN_STATUSES.map((status) => ({ label: campaignStatusLabels[status], value: status })),
];

function getDeleteDisabledReason(campaign: CampaignListItem): string | undefined {
  if (campaign.status !== 'draft') return '只有草稿活动可以删除，已启动或已暂停的活动会保留记录';
  if (campaign.journeyCount > 0) return '该活动存在引用旅程，请先删除活动中的旅程';
  return undefined;
}

function getCampaignColumns(
  search: string,
  onEdit: (campaign: CampaignListItem, button: HTMLElement) => void,
  onDelete: (campaign: CampaignListItem) => void,
  editingCampaignId?: string,
  actionsDisabled = false,
): NonNullable<TableProps<CampaignListItem>['columns']> {
  return [
    {
      title: '活动名称',
      dataIndex: 'name',
      key: 'name',
      width: 220,
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
      title: '活动说明',
      dataIndex: 'description',
      key: 'description',
      width: 240,
      render: (description: string | null) =>
        description === null ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Typography.Text ellipsis={{ tooltip: description }}>{description}</Typography.Text>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: CampaignStatus) => (
        <Badge status={campaignStatusBadges[status]} text={campaignStatusLabels[status]} />
      ),
    },
    {
      title: '预算',
      dataIndex: 'budget',
      key: 'budget',
      width: 140,
      render: (budget: CampaignListItem['budget']) =>
        budget === null ? (
          <Typography.Text type="secondary">未设置</Typography.Text>
        ) : (
          budget.amount
        ),
    },
    {
      title: '旅程数',
      dataIndex: 'journeyCount',
      key: 'journeyCount',
      width: 100,
      render: (count: number) => count.toLocaleString('zh-CN'),
    },
    {
      title: '创建人',
      dataIndex: 'createdBy',
      key: 'createdBy',
      width: 140,
      render: (createdBy: CampaignListItem['createdBy']) => createdBy.displayName,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 190,
      render: formatDateTime,
    },
    {
      title: '操作',
      key: 'actions',
      className: 'table-operation-cell',
      align: 'center',
      width: 150,
      fixed: 'end',
      render: (_value: unknown, campaign: CampaignListItem) => {
        const deleteDisabledReason = getDeleteDisabledReason(campaign);
        const deleteDisabled = deleteDisabledReason !== undefined || actionsDisabled;

        return (
          <Flex align="center" justify="center" gap={4}>
            <Button
              type="link"
              loading={editingCampaignId === campaign.id}
              disabled={
                !canEditCampaign(campaign.status) ||
                (actionsDisabled && editingCampaignId !== campaign.id)
              }
              onClick={(event) => onEdit(campaign, event.currentTarget)}
            >
              编辑
            </Button>
            <Divider vertical />
            {deleteDisabledReason ? (
              <Tooltip title={deleteDisabledReason}>
                <span>
                  <Button type="link" danger disabled>
                    删除
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Popconfirm
                title="删除活动？"
                description={`确定删除“${campaign.name}”活动吗？删除后无法恢复。`}
                okText="删除活动"
                cancelText="保留活动"
                okButtonProps={{ danger: true }}
                onConfirm={() => onDelete(campaign)}
              >
                <Button type="link" danger disabled={deleteDisabled}>
                  删除
                </Button>
              </Popconfirm>
            )}
          </Flex>
        );
      },
    },
  ];
}

export function CampaignsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const editButtonRef = useRef<HTMLElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<CampaignDetail>();
  const [editingCampaignId, setEditingCampaignId] = useState<string>();
  const [editTarget, setEditTarget] = useState<CampaignListItem>();
  const [editError, setEditError] = useState<string>();
  const [deleteError, setDeleteError] = useState<{
    campaignId: string;
    message: string;
    hasJourneys: boolean;
  }>();
  const [refreshNotice, setRefreshNotice] = useState<RefreshNotice | undefined>(
    location.state === 'campaign-deleted' ? 'deleted' : undefined,
  );
  const deleteMutation = useMutation({ mutationFn: deleteCampaign });
  const [form] = Form.useForm<FilterValues>();
  const query = searchParams.get('q') ?? '';
  const rawStatus = searchParams.get('status');
  const status = CAMPAIGN_STATUSES.find((value) => value === rawStatus) ?? 'all';
  const { page, pageSize, pageParam, pageSizeParam, setPagination } = useListPagination();

  const queryInput: CampaignListQueryInput = {
    q: query || undefined,
    status: status === 'all' ? undefined : status,
    page: pageParam,
    pageSize: pageSizeParam,
  };
  const listQuery = useQuery({
    queryKey: campaignQueryKeys.list(queryInput),
    queryFn: ({ signal }) => getCampaigns(queryInput, signal),
  });
  const list = listQuery.data;
  useSyncListPage(listQuery);

  // 网址变化（从详情返回、浏览器前进后退）时回填筛选表单；编辑表单不写网址。
  useEffect(() => {
    form.setFieldsValue({ q: query, status });
  }, [form, query, status]);

  useEffect(() => {
    if (location.state !== 'campaign-deleted') return;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate]);

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
        : refreshNotice === 'saved'
          ? '活动已保存，列表暂时无法刷新'
          : refreshNotice === 'deleted'
            ? '活动已删除，列表暂时无法刷新'
            : getApiErrorMessage(listQuery.error)
      : undefined;

  async function openEdit(campaign: CampaignListItem, button: HTMLElement): Promise<void> {
    if (!canEditCampaign(campaign.status)) return;
    editButtonRef.current = button;
    setEditTarget(campaign);
    setEditError(undefined);
    setEditingCampaignId(campaign.id);
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: campaignQueryKeys.detail(campaign.id),
        queryFn: ({ signal }) => getCampaign(campaign.id, signal),
      });
      setEditingCampaign(detail);
      setEditTarget(undefined);
    } catch (error) {
      if (!isSessionExpired(error)) setEditError(getApiErrorMessage(error));
    } finally {
      setEditingCampaignId(undefined);
    }
  }

  async function handleEdited(saved: CampaignDetail): Promise<void> {
    setEditingCampaign(undefined);
    setEditTarget(undefined);
    setEditError(undefined);
    queryClient.setQueryData(campaignQueryKeys.detail(saved.id), saved);
    await refreshAfterListWrite('saved');
  }

  async function deleteFromList(campaign: CampaignListItem): Promise<void> {
    if (getDeleteDisabledReason(campaign) !== undefined || deleteMutation.isPending) return;
    setDeleteError(undefined);
    let deleted = false;
    try {
      await deleteMutation.mutateAsync(campaign.id);
      deleted = true;
      queryClient.removeQueries({ queryKey: campaignQueryKeys.detail(campaign.id) });
      await refreshAfterListWrite('deleted');
    } catch (error) {
      if (isSessionExpired(error)) return;
      if (deleted) {
        setRefreshNotice('deleted');
      } else {
        setDeleteError({
          campaignId: campaign.id,
          message: getWriteErrorMessage(error),
          hasJourneys: error instanceof ApiError && error.code === 'CAMPAIGN_HAS_JOURNEYS',
        });
      }
    }
  }

  async function refreshAfterListWrite(notice: 'saved' | 'deleted'): Promise<void> {
    try {
      await queryClient.invalidateQueries({
        queryKey: campaignQueryKeys.lists,
        refetchType: 'none',
      });
      await listQuery.refetch({ throwOnError: true });
    } catch (error) {
      if (!isSessionExpired(error)) setRefreshNotice(notice);
    }
  }

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

  const actionsDisabled =
    deleteMutation.isPending || editingCampaignId !== undefined || editingCampaign !== undefined;
  const columns = getCampaignColumns(
    location.search,
    openEdit,
    deleteFromList,
    editingCampaignId,
    actionsDisabled,
  );
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
              <Col {...listFilterColProps}>
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
              <Col {...listFilterColProps}>
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

          {editError && (
            <Alert
              style={{ marginBottom: 16 }}
              type="error"
              showIcon
              title={editError}
              action={
                editTarget && (
                  <Button
                    type="link"
                    onClick={() => {
                      const button = editButtonRef.current;
                      if (button !== null) void openEdit(editTarget, button);
                    }}
                  >
                    重试
                  </Button>
                )
              }
            />
          )}

          {deleteError && (
            <Alert
              style={{ marginBottom: 16 }}
              type="error"
              showIcon
              title={deleteError.message}
              action={
                deleteError.hasJourneys ? (
                  <Link
                    to={`/campaigns/${deleteError.campaignId}#journeys`}
                    state={{ returnTo: location.search }}
                  >
                    查看旅程
                  </Link>
                ) : undefined
              }
            />
          )}

          {list !== undefined && (
            <Table<CampaignListItem>
              rowKey="id"
              columns={columns}
              dataSource={list.data}
              pagination={false}
              scroll={{ x: 1300 }}
              tableLayout="fixed"
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
      <CampaignFormDrawer
        open={editingCampaign !== undefined}
        {...(editingCampaign ? { campaign: editingCampaign } : {})}
        onCancel={() => {
          setEditingCampaign(undefined);
          setEditTarget(undefined);
          setEditError(undefined);
        }}
        onSaved={handleEdited}
        restoreFocus={() => editButtonRef.current?.focus()}
      />
    </section>
  );
}
