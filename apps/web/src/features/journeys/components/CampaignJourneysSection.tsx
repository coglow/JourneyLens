import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Empty,
  Flex,
  Form,
  Input,
  App as AntApp,
  Pagination,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import {
  PAGE_SIZES,
  canEditCampaign,
  type CampaignStatus,
  type JourneyDetail,
  type JourneyListItem,
  type JourneyListQueryInput,
} from '@journeylens/shared';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useListPagination, useSyncListPage } from '@/hooks/use-list-pagination';
import { getApiErrorMessage, getWriteErrorMessage, isSessionExpired } from '@/services/api';
import { deleteJourney, getJourneys } from '@/services/journeys';
import { journeyQueryKeys } from '../journey-queries';
import { JourneyFormDrawer } from './JourneyFormDrawer';
import { formatDateTime } from '@/utils/format-date-time';

type Props = { campaignId: string; campaignStatus: CampaignStatus };
type FilterValues = { q?: string };
type DeleteError = { message: string; journeyId: string };

export function CampaignJourneysSection({ campaignId, campaignStatus }: Props) {
  const { modal } = AntApp.useApp();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const editButtonRefs = useRef(new Map<string, HTMLElement>());
  const [form] = Form.useForm<FilterValues>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingJourney, setEditingJourney] = useState<JourneyListItem>();
  const [deleteError, setDeleteError] = useState<DeleteError>();
  const [refreshNotice, setRefreshNotice] = useState<'saved' | 'deleted'>();
  const query = searchParams.get('q') ?? '';
  const { page, pageParam, pageSizeParam, setPagination } = useListPagination();
  const queryInput: JourneyListQueryInput = {
    q: query || undefined,
    page: pageParam,
    pageSize: pageSizeParam,
  };
  const listQuery = useQuery({
    queryKey: journeyQueryKeys.list(campaignId, queryInput),
    queryFn: ({ signal }) => getJourneys(campaignId, queryInput, signal),
    // 页码修正会换查询键；保留上一批内容到新页读取完成，表格会同时显示加载状态。
    placeholderData: keepPreviousData,
  });
  const deleteMutation = useMutation({ mutationFn: deleteJourney });
  const list = listQuery.data;
  // 草稿与暂停都能维护旅程；删除仍逐条受 versionCount 限制。
  const writable = canEditCampaign(campaignStatus);
  useSyncListPage(listQuery);

  useEffect(() => {
    form.setFieldsValue({ q: query });
  }, [form, query]);

  useEffect(() => {
    if (refreshNotice && listQuery.isSuccess && !listQuery.isFetching && listQuery.error === null) {
      setRefreshNotice(undefined);
    }
  }, [listQuery.error, listQuery.isFetching, listQuery.isSuccess, refreshNotice]);

  const loadError =
    listQuery.error !== null && !isSessionExpired(listQuery.error)
      ? refreshNotice === 'saved'
        ? '旅程已保存，列表暂时无法刷新'
        : refreshNotice === 'deleted'
          ? '旅程已删除，列表暂时无法刷新'
          : getApiErrorMessage(listQuery.error)
      : undefined;

  function applySearch(values: FilterValues): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        const keyword = values.q?.trim() ?? '';
        if (keyword) next.set('q', keyword);
        else next.delete('q');
        next.delete('page');
        return next;
      },
      { state: location.state },
    );
  }

  async function refreshList(): Promise<void> {
    try {
      await listQuery.refetch({ throwOnError: true });
    } catch {
      setRefreshNotice('saved');
    }
  }

  function handleSaved(saved: JourneyDetail, created: boolean): void {
    setDrawerOpen(false);
    setDeleteError(undefined);
    queryClient.setQueryData(journeyQueryKeys.detail(saved.id), saved);
    void queryClient.invalidateQueries({ queryKey: journeyQueryKeys.lists, refetchType: 'none' });
    setRefreshNotice('saved');
    if (created && page !== 1) {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('page');
          return next;
        },
        { state: location.state },
      );
      return;
    }
    void refreshList();
  }

  function confirmDelete(journey: JourneyListItem): void {
    if (deleteMutation.isPending) return;
    modal.confirm({
      title: '删除旅程？',
      content: `确定删除“${journey.name}”旅程吗？删除后无法恢复。`,
      okText: '删除旅程',
      cancelText: '保留旅程',
      okButtonProps: { danger: true },
      onOk: async () => {
        setDeleteError(undefined);
        try {
          await deleteMutation.mutateAsync(journey.id);
        } catch (error) {
          if (!isSessionExpired(error))
            setDeleteError({ message: getWriteErrorMessage(error), journeyId: journey.id });
          return;
        }
        queryClient.removeQueries({ queryKey: journeyQueryKeys.detail(journey.id) });
        void queryClient.invalidateQueries({
          queryKey: journeyQueryKeys.lists,
          refetchType: 'none',
        });
        setRefreshNotice('deleted');
        try {
          await listQuery.refetch({ throwOnError: true });
        } catch {
          // 删除已成功，列表读取失败时保留独立提示。
          setRefreshNotice('deleted');
        }
      },
    });
  }

  function openCreate(): void {
    setEditingJourney(undefined);
    setDrawerOpen(true);
  }

  function openEdit(journey: JourneyListItem): void {
    setEditingJourney(journey);
    setDrawerOpen(true);
  }

  // 列宽合计：操作列只在可写时出现，两种情况的表格总宽度不同。
  const tableScrollX = writable ? 1170 : 1020;

  const columns: NonNullable<TableProps<JourneyListItem>['columns']> = [
    {
      title: '旅程名称',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      render: (name: string, journey) => (
        <Link
          to={`/journeys/${journey.id}`}
          state={{
            returnTo: `${location.pathname}${location.search}`,
            returnState: location.state,
          }}
          style={{ fontWeight: 600 }}
        >
          {name}
        </Link>
      ),
    },
    {
      title: '旅程说明',
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
      title: '入口分群',
      dataIndex: 'segment',
      key: 'segment',
      width: 220,
      render: (segment: JourneyListItem['segment']) =>
        segment ? (
          <Link to={`/segments/${segment.id}`} style={{ fontWeight: 600 }}>
            {segment.name}
          </Link>
        ) : (
          <Typography.Text type="secondary">不限人群</Typography.Text>
        ),
    },
    {
      title: '状态',
      dataIndex: 'versionCount',
      key: 'versionCount',
      width: 150,
      render: (versionCount: number) =>
        versionCount === 0 ? (
          <Typography.Text type="secondary">未发布</Typography.Text>
        ) : (
          <Flex align="center" gap={6} wrap>
            <Tag color="success" style={{ marginInlineEnd: 0 }}>
              已发布
            </Tag>
            <Typography.Text type="secondary">共 {versionCount} 版</Typography.Text>
          </Flex>
        ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 190,
      render: formatDateTime,
    },
    ...(writable
      ? [
          {
            title: '操作',
            key: 'actions',
            className: 'table-operation-cell',
            width: 150,
            fixed: 'end',
            render: (_value: unknown, journey: JourneyListItem) => (
              <Flex gap={8}>
                <Button
                  ref={(button) => {
                    if (button === null) editButtonRefs.current.delete(journey.id);
                    else editButtonRefs.current.set(journey.id, button);
                  }}
                  type="link"
                  size="small"
                  disabled={deleteMutation.isPending}
                  onClick={() => openEdit(journey)}
                >
                  编辑
                </Button>
                {journey.versionCount > 0 ? (
                  <Tooltip title="该旅程已有发布版本，不能删除">
                    <span style={{ display: 'inline-flex', cursor: 'not-allowed' }}>
                      <Button type="link" size="small" danger disabled>
                        删除
                      </Button>
                    </span>
                  </Tooltip>
                ) : (
                  <Button
                    type="link"
                    size="small"
                    danger
                    disabled={deleteMutation.isPending}
                    onClick={() => confirmDelete(journey)}
                  >
                    删除
                  </Button>
                )}
              </Flex>
            ),
          } satisfies NonNullable<TableProps<JourneyListItem>['columns']>[number],
        ]
      : []),
  ];

  return (
    <section id="journeys" aria-label="活动旅程" style={{ marginTop: 24 }}>
      <Flex vertical gap={16}>
        <Flex justify="space-between" align="center" gap={16} wrap>
          <Typography.Title level={3} style={{ margin: 0 }}>
            旅程
          </Typography.Title>
          {writable && (
            <Button
              ref={createButtonRef}
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreate}
            >
              新建旅程
            </Button>
          )}
        </Flex>
        <Form form={form} layout="inline" onFinish={applySearch}>
          <Form.Item name="q" label="关键词">
            <Input
              allowClear
              maxLength={100}
              placeholder="搜索旅程名称"
              prefix={<SearchOutlined aria-hidden="true" />}
              style={{ width: 280 }}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            查 询
          </Button>
        </Form>
        {deleteError && (
          <Alert
            type="error"
            showIcon
            title={deleteError.message}
            action={
              <Link
                to={`/journeys/${deleteError.journeyId}`}
                state={{ returnTo: `${location.pathname}${location.search}` }}
              >
                查看旅程
              </Link>
            }
            closable={{ onClose: () => setDeleteError(undefined) }}
          />
        )}
        {loadError && (
          <Alert
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
        {list === undefined && listQuery.isPending ? (
          <Flex
            justify="center"
            role="status"
            aria-label="正在读取旅程"
            style={{ padding: '48px 0' }}
          >
            <Spin />
          </Flex>
        ) : list !== undefined ? (
          <>
            <Table<JourneyListItem>
              rowKey="id"
              columns={columns}
              dataSource={list.data}
              pagination={false}
              scroll={{ x: tableScrollX }}
              tableLayout="fixed"
              loading={listQuery.isFetching}
              locale={{
                emptyText: loadError ? null : (
                  <Empty description={query ? '没有符合条件的旅程' : '暂无旅程'} />
                ),
              }}
            />
            <Flex justify="end">
              <Pagination
                current={list.page.page}
                pageSize={list.page.pageSize}
                total={list.page.total}
                pageSizeOptions={[...PAGE_SIZES]}
                showSizeChanger={{ id: 'journey-page-size', 'aria-label': '每页条数' }}
                showQuickJumper
                disabled={listQuery.isFetching}
                showTotal={(total) => `共 ${total} 条`}
                onChange={setPagination}
              />
            </Flex>
          </>
        ) : null}
      </Flex>
      <JourneyFormDrawer
        open={drawerOpen}
        campaignId={campaignId}
        {...(editingJourney ? { journey: editingJourney } : {})}
        onCancel={() => setDrawerOpen(false)}
        onSaved={handleSaved}
        restoreFocus={() => {
          if (editingJourney) editButtonRefs.current.get(editingJourney.id)?.focus();
          else createButtonRef.current?.focus();
        }}
      />
    </section>
  );
}
