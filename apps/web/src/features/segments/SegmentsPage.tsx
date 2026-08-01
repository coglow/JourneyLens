import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Col,
  Empty,
  Flex,
  Form,
  Input,
  message,
  Pagination,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import type { TableProps } from 'antd';
import { PAGE_SIZES, type SegmentListQueryInput, type SegmentListItem } from '@journeylens/shared';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  ApiError,
  getApiErrorMessage,
  getWriteErrorMessage,
  isSessionExpired,
} from '@/services/api';
import {
  deleteSegment,
  getSegment,
  getSegments,
  refreshSegmentEstimate,
} from '@/services/segments';
import { ListFilterBar, listFilterColProps } from '@/components/ListFilterBar';
import { ListPageLayout } from '@/components/ListPageLayout';
import { PageHeader } from '@/components/PageHeader';
import { useListPagination, useSyncListPage } from '@/hooks/use-list-pagination';
import { formatDateTime } from '@/utils/format-date-time';
import { summarizeSegmentRule } from './segment-rules';
import { applySegmentEstimate, segmentQueryKeys } from './segment-queries';
import { SEGMENT_IN_USE_MESSAGE, confirmSegmentDeletion } from './segment-delete';
import { SegmentFormDrawer } from '@/features/segments/components/SegmentFormDrawer';

type FilterValues = { q?: string };
type RefreshNotice = 'created' | 'deleted';
type SegmentRowActions = {
  busy: boolean;
  estimatingId?: string;
  deletingId?: string;
  onEstimate: (segment: SegmentListItem) => void;
  onEdit: (segment: SegmentListItem) => void;
  onDelete: (segment: SegmentListItem) => void;
  setEditButton: (id: string, button: HTMLElement | null) => void;
};

function getSegmentColumns(
  search: string,
  actions: SegmentRowActions,
): NonNullable<TableProps<SegmentListItem>['columns']> {
  return [
    {
      title: '分群名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (name: string, segment) => (
        <Link
          to={`/segments/${segment.id}`}
          state={{ returnTo: search }}
          style={{ fontWeight: 600 }}
        >
          {name}
        </Link>
      ),
    },
    {
      title: '分群说明',
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
      title: '规则摘要',
      dataIndex: 'rules',
      key: 'rules',
      width: 300,
      render: (rules: SegmentListItem['rules']) => (
        <Typography.Text ellipsis={{ tooltip: summarizeSegmentRule(rules) }}>
          {summarizeSegmentRule(rules)}
        </Typography.Text>
      ),
    },
    {
      title: '最近预估人数',
      dataIndex: 'audienceEstimate',
      key: 'audienceEstimate',
      width: 200,
      render: (estimate: SegmentListItem['audienceEstimate']) => {
        if (estimate === null) return <Typography.Text type="secondary">尚未计算</Typography.Text>;
        return (
          <Flex vertical gap={4}>
            <Flex align="center" gap={8} wrap>
              <span>
                {estimate.matched.toLocaleString('zh-CN')} /{' '}
                {estimate.total.toLocaleString('zh-CN')}
              </span>
              {estimate.isStale && <Tag color="warning">需要重新计算</Tag>}
            </Flex>
            <Typography.Text type="secondary">
              {formatDateTime(estimate.calculatedAt)}
            </Typography.Text>
          </Flex>
        );
      },
    },
    {
      title: '引用旅程数',
      dataIndex: 'journeyCount',
      key: 'journeyCount',
      width: 120,
      render: (count: number) => count.toLocaleString('zh-CN'),
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
      width: 190,
      fixed: 'end',
      render: (_value: unknown, segment: SegmentListItem) => {
        const inUse = segment.journeyCount > 0;
        return (
          <Flex gap={4} wrap={false}>
            <Button
              type="link"
              size="small"
              loading={actions.estimatingId === segment.id}
              disabled={actions.busy}
              onClick={() => actions.onEstimate(segment)}
            >
              预估
            </Button>
            <Button
              ref={(button) => actions.setEditButton(segment.id, button)}
              type="link"
              size="small"
              disabled={actions.busy}
              onClick={() => actions.onEdit(segment)}
            >
              编辑
            </Button>
            {inUse ? (
              <Tooltip
                title={
                  <span>
                    {SEGMENT_IN_USE_MESSAGE}{' '}
                    <Link
                      to={`/segments/${segment.id}#usages`}
                      state={{ returnTo: search }}
                      style={{
                        color: 'var(--ant-color-primary, #1677ff)',
                        textDecoration: 'underline',
                      }}
                    >
                      查看引用旅程
                    </Link>
                  </span>
                }
              >
                <span>
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
                loading={actions.deletingId === segment.id}
                disabled={actions.busy}
                onClick={() => actions.onDelete(segment)}
              >
                删除
              </Button>
            )}
          </Flex>
        );
      },
    },
  ];
}

export function SegmentsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const editButtonRefs = useRef(new Map<string, HTMLElement>());
  const lastDrawerOpener = useRef<'create' | 'edit'>('create');
  const lastEditedSegmentId = useRef<string | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [editSegmentId, setEditSegmentId] = useState<string>();
  const [actionError, setActionError] = useState<{ message: string; segmentId?: string }>();
  const [saveEstimateWarning, setSaveEstimateWarning] = useState<string>();
  const [refreshNotice, setRefreshNotice] = useState<RefreshNotice | undefined>(
    location.state === 'segment-deleted'
      ? 'deleted'
      : location.state === 'segment-created'
        ? 'created'
        : undefined,
  );
  const [form] = Form.useForm<FilterValues>();
  const [messageApi, messageContextHolder] = message.useMessage();
  const query = searchParams.get('q') ?? '';
  const { page, pageSize, pageParam, pageSizeParam, setPagination } = useListPagination();

  const queryInput: SegmentListQueryInput = {
    q: query || undefined,
    page: pageParam,
    pageSize: pageSizeParam,
  };
  const listQuery = useQuery({
    queryKey: segmentQueryKeys.list(queryInput),
    queryFn: ({ signal }) => getSegments(queryInput, signal),
  });
  const list = listQuery.data;
  useSyncListPage(listQuery);
  const estimateMutation = useMutation({
    mutationFn: async (segmentId: string) => {
      const currentSegment = await getSegment(segmentId);
      const estimate = await refreshSegmentEstimate(segmentId, currentSegment.revision);
      return { currentSegment, estimate };
    },
    onSuccess: ({ currentSegment, estimate }) => {
      applySegmentEstimate(queryClient, currentSegment, estimate);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteSegment,
    onSuccess: (_result, segmentId) => {
      queryClient.removeQueries({ queryKey: segmentQueryKeys.detail(segmentId) });
      void queryClient.invalidateQueries({ queryKey: segmentQueryKeys.lists });
      setActionError(undefined);
    },
  });
  const actionBusy = estimateMutation.isPending || deleteMutation.isPending;

  useEffect(() => {
    form.setFieldsValue({ q: query });
  }, [form, query]);

  useEffect(() => {
    if (location.state !== 'segment-deleted') return;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (refreshNotice === undefined) return;
    if (listQuery.isSuccess && !listQuery.isFetching && listQuery.error === null) {
      setRefreshNotice(undefined);
    }
  }, [listQuery.error, listQuery.isFetching, listQuery.isSuccess, refreshNotice]);

  const loadError =
    listQuery.error !== null && !isSessionExpired(listQuery.error)
      ? refreshNotice === 'created'
        ? '分群已创建，列表暂时无法刷新'
        : refreshNotice === 'deleted'
          ? '分群已删除，列表暂时无法刷新'
          : getApiErrorMessage(listQuery.error)
      : undefined;

  function applyFilters(values: FilterValues): void {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      const keyword = values.q?.trim() ?? '';
      if (keyword) next.set('q', keyword);
      else next.delete('q');
      next.delete('page');
      return next;
    });
  }

  function resetFilters(): void {
    form.setFieldsValue({ q: '' });
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('q');
      next.delete('page');
      return next;
    });
  }

  function handleCreated(): void {
    setCreateOpen(false);
    setRefreshNotice('created');
    if (page !== 1) {
      setPagination(1, pageSize);
      return;
    }
    void listQuery.refetch().catch(() => undefined);
  }

  function estimateSavedSegment(segment: SegmentListItem): void {
    const messageKey = `segment-estimate-${segment.id}`;
    setSaveEstimateWarning(undefined);
    // 同一分群复用同一条消息：加载中会被结果替换，不会堆叠。
    void messageApi.open({
      key: messageKey,
      type: 'loading',
      content: '正在计算预估人数…',
      duration: 0,
    });
    estimateMutation.mutateAsync(segment.id).then(
      () => {
        void messageApi.success({
          key: messageKey,
          content: '预估完成，已更新最近预估人数',
          duration: 2,
        });
      },
      (error: unknown) => {
        if (isSessionExpired(error)) {
          void messageApi.destroy(messageKey);
          return;
        }
        void messageApi.error({
          key: messageKey,
          content: getWriteErrorMessage(error),
          duration: 3,
        });
      },
    );
  }

  function editSegment(segment: SegmentListItem): void {
    lastDrawerOpener.current = 'edit';
    lastEditedSegmentId.current = segment.id;
    setCreateOpen(false);
    setEditSegmentId(segment.id);
  }

  function confirmDelete(segment: SegmentListItem): void {
    if (deleteMutation.isPending) return;
    confirmSegmentDeletion(segment.name, async () => {
      setActionError(undefined);
      try {
        await deleteMutation.mutateAsync(segment.id);
      } catch (error) {
        if (!isSessionExpired(error)) {
          setActionError({
            message: getWriteErrorMessage(error),
            ...(error instanceof ApiError && error.code === 'SEGMENT_IN_USE'
              ? { segmentId: segment.id }
              : {}),
          });
        }
      }
    });
  }

  function restoreDrawerFocus(): void {
    if (lastDrawerOpener.current === 'create') {
      createButtonRef.current?.focus();
      return;
    }
    const segmentId = lastEditedSegmentId.current;
    if (segmentId !== undefined) editButtonRefs.current.get(segmentId)?.focus();
  }

  return (
    <section aria-label="全部分群">
      {messageContextHolder}
      <Flex vertical gap={16} style={{ maxWidth: 1560, margin: '0 auto' }}>
        <PageHeader
          title="分群"
          actions={
            <Button
              ref={createButtonRef}
              type="primary"
              size="large"
              icon={<PlusOutlined />}
              onClick={() => {
                lastDrawerOpener.current = 'create';
                setEditSegmentId(undefined);
                setCreateOpen(true);
              }}
            >
              新建分群
            </Button>
          }
        />
        <ListPageLayout
          loading={list === undefined && listQuery.isPending}
          loadingLabel="正在读取分群"
          filters={
            <ListFilterBar form={form} onSearch={applyFilters} onReset={resetFilters}>
              <Col {...listFilterColProps}>
                <Form.Item name="q" label="关键词">
                  <Input
                    allowClear
                    maxLength={100}
                    placeholder="搜索分群名称或说明"
                    prefix={<SearchOutlined aria-hidden="true" />}
                    style={{ width: '100%' }}
                  />
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
                showSizeChanger={{ id: 'segment-page-size', 'aria-label': '每页条数' }}
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

          {actionError && (
            <Alert
              style={{ marginBottom: 16 }}
              type="error"
              showIcon
              title={actionError.message}
              action={
                actionError.segmentId ? (
                  <Link
                    to={`/segments/${actionError.segmentId}#usages`}
                    state={{ returnTo: location.search }}
                  >
                    查看引用
                  </Link>
                ) : undefined
              }
              closable={{ onClose: () => setActionError(undefined) }}
            />
          )}

          {saveEstimateWarning && (
            <Alert
              style={{ marginBottom: 16 }}
              type="warning"
              showIcon
              title={saveEstimateWarning}
              closable={{ onClose: () => setSaveEstimateWarning(undefined) }}
            />
          )}

          {list !== undefined && (
            <Table<SegmentListItem>
              rowKey="id"
              columns={getSegmentColumns(location.search, {
                busy: actionBusy,
                ...(estimateMutation.isPending ? { estimatingId: estimateMutation.variables } : {}),
                ...(deleteMutation.isPending ? { deletingId: deleteMutation.variables } : {}),
                onEstimate: estimateSavedSegment,
                onEdit: editSegment,
                onDelete: confirmDelete,
                setEditButton: (id, button) => {
                  if (button === null) editButtonRefs.current.delete(id);
                  else editButtonRefs.current.set(id, button);
                },
              })}
              dataSource={list.data}
              pagination={false}
              scroll={{ x: 1440 }}
              size="middle"
              tableLayout="fixed"
              loading={listQuery.isFetching}
              locale={{
                emptyText: loadError ? null : (
                  <Empty description={query ? '没有符合条件的分群' : '暂无分群'} />
                ),
              }}
            />
          )}
        </ListPageLayout>
      </Flex>
      <SegmentFormDrawer
        open={createOpen || editSegmentId !== undefined}
        {...(editSegmentId === undefined ? {} : { segmentId: editSegmentId })}
        onCancel={() => {
          setCreateOpen(false);
          setEditSegmentId(undefined);
        }}
        onSaved={(saved, estimateRefreshFailed) => {
          setActionError(undefined);
          setSaveEstimateWarning(
            estimateRefreshFailed
              ? '分群已保存，但预估人数未更新。可在操作列点击“预估”重试。'
              : undefined,
          );
          if (editSegmentId === undefined) {
            handleCreated();
            return;
          }
          setEditSegmentId(undefined);
          queryClient.setQueryData(segmentQueryKeys.detail(saved.id), saved);
          void queryClient.invalidateQueries({ queryKey: segmentQueryKeys.lists });
        }}
        restoreFocus={restoreDrawerFocus}
      />
    </section>
  );
}
