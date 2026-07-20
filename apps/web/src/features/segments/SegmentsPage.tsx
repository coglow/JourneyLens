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
  Pagination,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import type { TableProps } from 'antd';
import { PAGE_SIZES, type SegmentListQueryInput, type SegmentListItem } from '@journeylens/shared';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { getApiErrorMessage, getWriteErrorMessage, isSessionExpired } from '@/services/api';
import {
  deleteSegment,
  getSegment,
  getSegments,
  refreshSegmentEstimate,
} from '@/services/segments';
import { ListFilterBar } from '@/components/ListFilterBar';
import { ListPageLayout } from '@/components/ListPageLayout';
import { PageHeader } from '@/components/PageHeader';
import { summarizeSegmentRule } from './segment-rules';
import { applySegmentEstimate, segmentQueryKeys } from './segment-queries';
import { confirmSegmentDeletion } from './segment-delete';
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

const filterCol = { xs: 24, sm: 16, lg: 12, xl: 8 };

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
      title: '规则摘要',
      dataIndex: 'rules',
      key: 'rules',
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
              {new Date(estimate.calculatedAt).toLocaleString('zh-CN')}
            </Typography.Text>
          </Flex>
        );
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 190,
      render: (updatedAt: string) => new Date(updatedAt).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      className: 'table-operation-cell',
      width: 190,
      render: (_value: unknown, segment: SegmentListItem) => (
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
        </Flex>
      ),
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
  const [actionError, setActionError] = useState<string>();
  const [saveEstimateWarning, setSaveEstimateWarning] = useState<string>();
  const [refreshNotice, setRefreshNotice] = useState<RefreshNotice | undefined>(
    location.state === 'segment-deleted'
      ? 'deleted'
      : location.state === 'segment-created'
        ? 'created'
        : undefined,
  );
  const [form] = Form.useForm<FilterValues>();
  const query = searchParams.get('q') ?? '';
  const rawPage = searchParams.get('page');
  const rawPageSize = searchParams.get('pageSize');
  const page = rawPage === null ? 1 : Number(rawPage);
  const pageSize = rawPageSize === '20' ? 20 : rawPageSize === '50' ? 50 : 10;

  const queryInput: SegmentListQueryInput = {
    q: query || undefined,
    page: rawPage ?? undefined,
    pageSize: rawPageSize ?? undefined,
  };
  const listQuery = useQuery({
    queryKey: segmentQueryKeys.list(queryInput),
    queryFn: ({ signal }) => getSegments(queryInput, signal),
  });
  const list = listQuery.data;
  const estimateMutation = useMutation({
    mutationFn: async (segmentId: string) => {
      const currentSegment = await getSegment(segmentId);
      const estimate = await refreshSegmentEstimate(segmentId, currentSegment.revision);
      return { currentSegment, estimate };
    },
    onSuccess: ({ currentSegment, estimate }) => {
      applySegmentEstimate(queryClient, currentSegment, estimate);
      setActionError(undefined);
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
    setActionError(undefined);
    setSaveEstimateWarning(undefined);
    void estimateMutation.mutateAsync(segment.id).catch((error: unknown) => {
      if (!isSessionExpired(error)) setActionError(getWriteErrorMessage(error));
    });
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
        if (!isSessionExpired(error)) setActionError(getWriteErrorMessage(error));
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
              <Col {...filterCol}>
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
              title={actionError}
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
