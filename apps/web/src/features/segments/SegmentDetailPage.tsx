import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Flex, Spin, Tag, Typography } from 'antd';
import { useLocation, useNavigate, useParams } from 'react-router';
import type { SegmentDetail } from '@journeylens/shared';
import { PageHeader } from '@/components/PageHeader';
import {
  ApiError,
  getApiErrorMessage,
  getWriteErrorMessage,
  isSessionExpired,
} from '@/services/api';
import { deleteSegment, getSegment, refreshSegmentEstimate } from '@/services/segments';
import { applySegmentEstimate, segmentQueryKeys } from './segment-queries';
import { confirmSegmentDeletion } from './segment-delete';
import { SegmentFormDrawer } from '@/features/segments/components/SegmentFormDrawer';
import { SegmentRuleView } from '@/features/segments/components/SegmentRuleView';

type RefreshError = { message: string; needsReload: boolean };

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN');
}

export function SegmentDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [refreshError, setRefreshError] = useState<RefreshError>();
  const [deleteError, setDeleteError] = useState<string>();
  const [editOpen, setEditOpen] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const returnTo =
    typeof location.state === 'object' &&
    location.state !== null &&
    'returnTo' in location.state &&
    typeof location.state.returnTo === 'string' &&
    location.state.returnTo.startsWith('?')
      ? location.state.returnTo
      : '';

  const detailQuery = useQuery({
    queryKey: segmentQueryKeys.detail(id),
    queryFn: ({ signal }) => getSegment(id, signal),
  });
  const refreshMutation = useMutation({
    mutationFn: (segment: SegmentDetail) => refreshSegmentEstimate(segment.id, segment.revision),
    onSuccess: (estimate, segment) => {
      applySegmentEstimate(queryClient, segment, estimate);
      setRefreshError(undefined);
    },
  });
  const deleteMutation = useMutation({ mutationFn: () => deleteSegment(id) });
  const queryError = detailQuery.error;
  const notFound = queryError instanceof ApiError && queryError.status === 404;
  const segment = notFound ? undefined : detailQuery.data;
  const loadError =
    segment === undefined && queryError !== null && !notFound && !isSessionExpired(queryError)
      ? getApiErrorMessage(queryError)
      : undefined;
  const refreshFailure =
    segment !== undefined && queryError !== null && !notFound && !isSessionExpired(queryError)
      ? getApiErrorMessage(queryError)
      : undefined;
  const refreshAlertTitle =
    refreshError?.message ?? (refreshFailure ? '分群暂时无法刷新' : undefined);

  function refreshSavedEstimate(target: SegmentDetail): void {
    setRefreshError(undefined);
    void refreshMutation.mutateAsync(target).catch((error: unknown) => {
      if (isSessionExpired(error)) return;
      if (error instanceof ApiError && error.code === 'SEGMENT_REVISION_CONFLICT') {
        setRefreshError({
          message: '分群已被修改，请重新读取最新规则后再预估。',
          needsReload: true,
        });
        return;
      }
      setRefreshError({ message: getWriteErrorMessage(error), needsReload: false });
    });
  }

  /** 修订冲突后读取最新详情；读取失败时保留“重新读取”入口，避免继续用旧修订号预估。 */
  async function reloadLatest(): Promise<void> {
    const result = await detailQuery.refetch();
    if (result.isSuccess) {
      setRefreshError(undefined);
      return;
    }
    if (!isSessionExpired(result.error)) {
      setRefreshError({
        message: '暂时无法读取最新分群，请稍后重试。',
        needsReload: true,
      });
    }
  }

  function confirmDelete(target: SegmentDetail): void {
    if (deleteMutation.isPending) return;
    confirmSegmentDeletion(target.name, async () => {
      setDeleteError(undefined);
      try {
        await deleteMutation.mutateAsync();
        queryClient.removeQueries({ queryKey: segmentQueryKeys.lists });
        queryClient.removeQueries({ queryKey: segmentQueryKeys.detail(id) });
        navigate(`/segments${returnTo}`, { state: 'segment-deleted' });
      } catch (error) {
        if (!isSessionExpired(error)) setDeleteError(getWriteErrorMessage(error));
      }
    });
  }

  return (
    <section aria-label="分群详情" style={{ maxWidth: 1080, margin: '0 auto' }}>
      <Flex vertical gap={16}>
        <PageHeader
          back={
            <Button
              type="link"
              style={{ paddingInline: 0 }}
              onClick={() => navigate(`/segments${returnTo}`)}
            >
              返回分群列表
            </Button>
          }
          title={segment?.name ?? '分群详情'}
          actions={
            segment !== undefined && (
              <>
                <Button
                  ref={editButtonRef}
                  disabled={refreshMutation.isPending || deleteMutation.isPending}
                  onClick={() => setEditOpen(true)}
                >
                  编辑分群
                </Button>
                <Button
                  type="primary"
                  loading={refreshMutation.isPending}
                  disabled={deleteMutation.isPending}
                  onClick={() => refreshSavedEstimate(segment)}
                >
                  预估人数
                </Button>
                <Button
                  danger
                  disabled={refreshMutation.isPending}
                  onClick={() => confirmDelete(segment)}
                >
                  删除分群
                </Button>
              </>
            )
          }
        />

        <Card>
          {refreshAlertTitle && (
            <Alert
              style={{ marginBottom: 16 }}
              type="warning"
              showIcon
              title={refreshAlertTitle}
              description={refreshError === undefined ? refreshFailure : null}
              action={
                <Button
                  onClick={() => {
                    if (refreshError?.needsReload) {
                      void reloadLatest();
                    } else if (refreshError !== undefined && segment !== undefined) {
                      refreshSavedEstimate(segment);
                    } else {
                      void detailQuery.refetch();
                    }
                  }}
                >
                  {refreshError?.needsReload ? '重新读取' : '重试'}
                </Button>
              }
            />
          )}
          {deleteError && (
            <Alert style={{ marginBottom: 16 }} type="error" showIcon title={deleteError} />
          )}
          {segment === undefined && detailQuery.isPending && (
            <div
              role="status"
              aria-label="正在读取分群"
              style={{ padding: '48px 0', textAlign: 'center' }}
            >
              <Spin />
            </div>
          )}
          {notFound && <Alert type="warning" showIcon title="分群不存在" />}
          {loadError && (
            <Alert
              type="error"
              showIcon
              title={loadError}
              action={<Button onClick={() => void detailQuery.refetch()}>重试</Button>}
            />
          )}
          {segment !== undefined && (
            <Descriptions bordered column={1}>
              <Descriptions.Item label="分群名称">{segment.name}</Descriptions.Item>
              <Descriptions.Item label="说明">{segment.description ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="最近预估人数">
                {segment.audienceEstimate === null ? (
                  <Typography.Text type="secondary">尚未计算</Typography.Text>
                ) : (
                  <Flex align="center" gap={8} wrap>
                    <Typography.Text>
                      {segment.audienceEstimate.matched.toLocaleString('zh-CN')}
                    </Typography.Text>
                    {segment.audienceEstimate.isStale && <Tag color="warning">需要重新计算</Tag>}
                  </Flex>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="最近预估时间">
                {segment.audienceEstimate === null
                  ? '尚未计算'
                  : formatDate(segment.audienceEstimate.calculatedAt)}
              </Descriptions.Item>
              <Descriptions.Item label="创建者">{segment.createdBy.displayName}</Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {formatDate(segment.createdAt)}
              </Descriptions.Item>
              <Descriptions.Item label="更新时间">
                {formatDate(segment.updatedAt)}
              </Descriptions.Item>
            </Descriptions>
          )}
        </Card>
        {segment !== undefined && (
          <Card title="分群规则">
            <SegmentRuleView rules={segment.rules} />
          </Card>
        )}
      </Flex>
      <SegmentFormDrawer
        open={editOpen}
        {...(segment === undefined ? {} : { segment })}
        onCancel={() => setEditOpen(false)}
        onSaved={(saved, estimateRefreshFailed) => {
          setEditOpen(false);
          setRefreshError(
            estimateRefreshFailed
              ? {
                  message: '分群已保存，但预估人数未更新。点击“重试”可重新计算。',
                  needsReload: false,
                }
              : undefined,
          );
          queryClient.setQueryData(segmentQueryKeys.detail(saved.id), saved);
          void queryClient.invalidateQueries({ queryKey: segmentQueryKeys.lists });
        }}
        restoreFocus={() => editButtonRef.current?.focus()}
      />
    </section>
  );
}
