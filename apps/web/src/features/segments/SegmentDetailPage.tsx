import { useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Flex,
  message,
  Row,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
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
import { SEGMENT_IN_USE_MESSAGE, confirmSegmentDeletion } from './segment-delete';
import { SegmentFormDrawer } from '@/features/segments/components/SegmentFormDrawer';
import { SegmentRuleView } from '@/features/segments/components/SegmentRuleView';
import { SegmentUsagesSection } from '@/features/segments/components/SegmentUsagesSection';
import { formatDateTime } from '@/utils/format-date-time';
import styles from './SegmentDetailPage.module.css';

type RefreshError = { message: string; needsReload: boolean };

/** 分群信息下方的单行字段：左侧灰色标签，右侧正文。 */
function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Flex gap={16}>
      <Typography.Text type="secondary" style={{ flex: '0 0 80px' }}>
        {label}
      </Typography.Text>
      <Typography.Text>{value}</Typography.Text>
    </Flex>
  );
}

export function SegmentDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [refreshError, setRefreshError] = useState<RefreshError>();
  const [deleteError, setDeleteError] = useState<{ message: string; inUse: boolean }>();
  const [editOpen, setEditOpen] = useState(false);
  const [messageApi, messageContextHolder] = message.useMessage();
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
    const messageKey = 'segment-estimate';
    setRefreshError(undefined);
    void messageApi.open({
      key: messageKey,
      type: 'loading',
      content: '正在计算预估人数…',
      duration: 0,
    });
    refreshMutation.mutateAsync(target).then(
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
        if (error instanceof ApiError && error.code === 'SEGMENT_REVISION_CONFLICT') {
          // 冲突后必须由用户确认重新读取，继续用页面提示承载操作按钮。
          void messageApi.destroy(messageKey);
          setRefreshError({
            message: '分群已被修改，请重新读取最新规则后再预估。',
            needsReload: true,
          });
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
        if (!isSessionExpired(error)) {
          setDeleteError({
            message: getWriteErrorMessage(error),
            inUse: error instanceof ApiError && error.code === 'SEGMENT_IN_USE',
          });
        }
      }
    });
  }

  return (
    <section aria-label="分群详情" style={{ maxWidth: 1080, margin: '0 auto' }}>
      {messageContextHolder}
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
                {segment.journeyCount > 0 ? (
                  <Tooltip
                    title={
                      <span>
                        {SEGMENT_IN_USE_MESSAGE}{' '}
                        <a
                          href="#usages"
                          style={{
                            color: 'var(--ant-color-primary, #1677ff)',
                            textDecoration: 'underline',
                          }}
                        >
                          查看引用旅程
                        </a>
                      </span>
                    }
                  >
                    <span>
                      <Button danger disabled>
                        删除分群
                      </Button>
                    </span>
                  </Tooltip>
                ) : (
                  <Button
                    danger
                    disabled={refreshMutation.isPending}
                    onClick={() => confirmDelete(segment)}
                  >
                    删除分群
                  </Button>
                )}
              </>
            )
          }
        />

        {segment === undefined && (
          <Card>
            {detailQuery.isPending && (
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
          </Card>
        )}
        {segment !== undefined && (
          <>
            {refreshAlertTitle && (
              <Alert
                type="warning"
                showIcon
                title={refreshAlertTitle}
                description={refreshError === undefined ? refreshFailure : null}
                action={
                  <Button
                    onClick={() => {
                      if (refreshError?.needsReload) {
                        void reloadLatest();
                      } else if (refreshError !== undefined) {
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
              <Alert
                type="error"
                showIcon
                title={deleteError.message}
                action={
                  deleteError.inUse ? (
                    <Button type="link" href="#usages">
                      查看引用
                    </Button>
                  ) : undefined
                }
              />
            )}
            <Row gutter={[16, 16]} align="stretch">
              <Col xs={24} lg={14}>
                <div className={styles.rulesSlot}>
                  <Card
                    className={styles.rulesCard ?? ''}
                    title="分群规则"
                    styles={{ body: { flex: '1 1 auto', minHeight: 0, overflow: 'auto' } }}
                  >
                    <SegmentRuleView rules={segment.rules} />
                  </Card>
                </div>
              </Col>
              <Col xs={24} lg={10}>
                <Card title="分群信息">
                  <Flex vertical gap={8}>
                    <Typography.Text strong style={{ fontSize: 20 }}>
                      {segment.name}
                    </Typography.Text>
                    <Typography.Text type="secondary">说明</Typography.Text>
                    <Typography.Text>{segment.description ?? '-'}</Typography.Text>
                  </Flex>
                  <Divider />
                  <Flex vertical gap={8}>
                    <Typography.Text type="secondary">最近预估人数</Typography.Text>
                    <Flex justify="space-between" align="center" gap={16} wrap>
                      <Flex align="center" gap={8} wrap>
                        <Typography.Text strong style={{ fontSize: 24 }}>
                          {segment.audienceEstimate === null
                            ? '尚未预估'
                            : segment.audienceEstimate.matched.toLocaleString('zh-CN')}
                        </Typography.Text>
                        {segment.audienceEstimate?.isStale && (
                          <Tag color="warning">需要重新计算</Tag>
                        )}
                      </Flex>
                      <Button
                        type="primary"
                        loading={refreshMutation.isPending}
                        disabled={deleteMutation.isPending}
                        onClick={() => refreshSavedEstimate(segment)}
                      >
                        预估人数
                      </Button>
                    </Flex>
                    <Typography.Text type="secondary">
                      预估时间：
                      {segment.audienceEstimate === null
                        ? '尚未预估'
                        : formatDateTime(segment.audienceEstimate.calculatedAt)}
                    </Typography.Text>
                  </Flex>
                  <Divider />
                  <Flex vertical gap={8}>
                    <InfoRow label="创建者：" value={segment.createdBy.displayName} />
                    <InfoRow label="创建时间：" value={formatDateTime(segment.createdAt)} />
                    <InfoRow label="更新时间：" value={formatDateTime(segment.updatedAt)} />
                  </Flex>
                </Card>
              </Col>
            </Row>
            <SegmentUsagesSection segmentId={segment.id} />
          </>
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
