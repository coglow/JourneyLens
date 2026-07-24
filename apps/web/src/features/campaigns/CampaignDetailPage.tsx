import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Descriptions, Flex, Modal, Spin } from 'antd';
import type { CampaignDetail } from '@journeylens/shared';
import { useLocation, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import {
  ApiError,
  getApiErrorMessage,
  getWriteErrorMessage,
  isSessionExpired,
} from '@/services/api';
import { deleteCampaign, getCampaign } from '@/services/campaigns';
import { formatDateTime } from '@/utils/format-date-time';
import { campaignQueryKeys } from './campaign-queries';
import { campaignStatusBadges, campaignStatusLabels } from './campaign-status';
import { CampaignFormDrawer } from './components/CampaignFormDrawer';
import { CampaignJourneysSection } from '@/features/journeys/components/CampaignJourneysSection';

export function CampaignDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [refreshError, setRefreshError] = useState<string>();
  const [deleteError, setDeleteError] = useState<{ message: string; hasJourneys: boolean }>();
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

  const campaignQuery = useQuery({
    queryKey: campaignQueryKeys.detail(id),
    queryFn: ({ signal }) => getCampaign(id, signal),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteCampaign(id),
  });
  const queryError = campaignQuery.error;
  const notFound = queryError instanceof ApiError && queryError.status === 404;
  // 后台刷新确认活动已不存在时，不再展示旧缓存内容。
  const campaign = notFound ? undefined : campaignQuery.data;
  const loadError =
    campaign === undefined && queryError !== null && !notFound && !isSessionExpired(queryError)
      ? getApiErrorMessage(queryError)
      : undefined;
  // 已有缓存但后台刷新失败时保留内容，同时提示刷新失败。
  const refreshFailure =
    campaign !== undefined && queryError !== null && !notFound && !isSessionExpired(queryError)
      ? getApiErrorMessage(queryError)
      : undefined;
  const refreshAlertTitle = refreshError ?? (refreshFailure ? '活动暂时无法刷新' : undefined);

  async function refreshDetail(reason?: 'saved'): Promise<void> {
    try {
      await campaignQuery.refetch({ throwOnError: true });
      setRefreshError(undefined);
    } catch (error) {
      if (!isSessionExpired(error) && reason === 'saved') {
        setRefreshError('活动已保存，暂时无法刷新');
      }
    }
  }

  function handleSaved(saved: CampaignDetail): void {
    setEditOpen(false);
    setDeleteError(undefined);
    setRefreshError(undefined);
    queryClient.setQueryData(campaignQueryKeys.detail(id), saved);
    void queryClient.invalidateQueries({ queryKey: campaignQueryKeys.lists });
    void refreshDetail('saved');
  }

  function confirmDelete(target: CampaignDetail): void {
    if (deleteMutation.isPending) return;
    Modal.confirm({
      title: '删除活动？',
      content: `确定删除“${target.name}”活动吗？删除后无法恢复。`,
      okText: '删除活动',
      cancelText: '保留活动',
      okButtonProps: { danger: true },
      onOk: async () => {
        setDeleteError(undefined);
        try {
          await deleteMutation.mutateAsync();
          // 删除后列表和详情都不能再展示旧数据，直接移除缓存，回到列表时重新读取。
          queryClient.removeQueries({ queryKey: campaignQueryKeys.lists });
          queryClient.removeQueries({ queryKey: campaignQueryKeys.detail(id) });
          navigate(`/campaigns${returnTo}`, { state: 'campaign-deleted' });
        } catch (error) {
          if (!isSessionExpired(error)) {
            setDeleteError({
              message: getWriteErrorMessage(error),
              hasJourneys: error instanceof ApiError && error.code === 'CAMPAIGN_HAS_JOURNEYS',
            });
          }
        }
      },
    });
  }

  return (
    <section aria-label="活动详情" style={{ maxWidth: 960, margin: '0 auto' }}>
      <Flex vertical gap={16}>
        <PageHeader
          back={
            <Button
              type="link"
              style={{ paddingInline: 0 }}
              onClick={() => navigate(`/campaigns${returnTo}`)}
            >
              返回活动列表
            </Button>
          }
          title={campaign?.name ?? '活动详情'}
          actions={
            campaign?.status === 'draft' ? (
              <>
                <Button
                  ref={editButtonRef}
                  disabled={deleteMutation.isPending}
                  onClick={() => setEditOpen(true)}
                >
                  编辑活动
                </Button>
                <Button
                  danger
                  disabled={deleteMutation.isPending}
                  onClick={() => confirmDelete(campaign)}
                >
                  删除活动
                </Button>
              </>
            ) : undefined
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
                  onClick={() =>
                    void refreshDetail(refreshError === undefined ? undefined : 'saved')
                  }
                >
                  重试
                </Button>
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
                  <Button type="link" href="#journeys">
                    查看旅程
                  </Button>
                ) : undefined
              }
            />
          )}

          {campaign === undefined && campaignQuery.isPending && (
            <div
              role="status"
              aria-label="正在读取活动"
              style={{ padding: '48px 0', textAlign: 'center' }}
            >
              <Spin />
            </div>
          )}

          {notFound && <Alert type="warning" showIcon title="活动不存在" />}

          {loadError && (
            <Alert
              type="error"
              showIcon
              title={loadError}
              action={<Button onClick={() => void campaignQuery.refetch()}>重试</Button>}
            />
          )}

          {campaign !== undefined && (
            <Descriptions bordered column={1}>
              <Descriptions.Item label="活动名称">{campaign.name}</Descriptions.Item>
              <Descriptions.Item label="说明">{campaign.description ?? '未填写'}</Descriptions.Item>
              <Descriptions.Item label="预算">
                {campaign.budget?.amount ?? '未设置'}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Badge
                  status={campaignStatusBadges[campaign.status]}
                  text={campaignStatusLabels[campaign.status]}
                />
              </Descriptions.Item>
              <Descriptions.Item label="创建者">{campaign.createdBy.displayName}</Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {formatDateTime(campaign.createdAt)}
              </Descriptions.Item>
              <Descriptions.Item label="更新时间">
                {formatDateTime(campaign.updatedAt)}
              </Descriptions.Item>
            </Descriptions>
          )}
        </Card>
      </Flex>

      {campaign !== undefined && (
        <CampaignJourneysSection campaignId={campaign.id} campaignStatus={campaign.status} />
      )}

      {campaign !== undefined && campaign.status === 'draft' && (
        <CampaignFormDrawer
          open={editOpen}
          campaign={campaign}
          onCancel={() => setEditOpen(false)}
          onSaved={handleSaved}
          restoreFocus={() => editButtonRef.current?.focus()}
        />
      )}
    </section>
  );
}
