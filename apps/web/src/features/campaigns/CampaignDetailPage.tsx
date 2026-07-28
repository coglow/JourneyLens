import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Descriptions, Flex, Modal, Spin } from 'antd';
import { canEditCampaign, type CampaignDetail } from '@journeylens/shared';
import { useLocation, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import {
  ApiError,
  getApiErrorMessage,
  getWriteErrorMessage,
  isSessionExpired,
} from '@/services/api';
import {
  deleteCampaign,
  getCampaign,
  transitionCampaign,
  type CampaignTransition,
} from '@/services/campaigns';
import { formatDateTime } from '@/utils/format-date-time';
import { campaignQueryKeys } from './campaign-queries';
import { campaignStatusBadges, campaignStatusLabels } from './campaign-status';
import { CampaignFormDrawer } from './components/CampaignFormDrawer';
import { CampaignJourneysSection } from '@/features/journeys/components/CampaignJourneysSection';

type TransitionConfirm = {
  action: CampaignTransition;
  title: string;
  content: string;
  okText: string;
  cancelText: string;
  notice: string;
  danger?: boolean;
};

export function CampaignDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [refreshError, setRefreshError] = useState<string>();
  const [deleteError, setDeleteError] = useState<{ message: string; hasJourneys: boolean }>();
  const [transitionError, setTransitionError] = useState<{
    message: string;
    code: string | undefined;
  }>();
  const [transitionNotice, setTransitionNotice] = useState<string>();
  const [editOpen, setEditOpen] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
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
  const transitionMutation = useMutation({
    mutationFn: (action: CampaignTransition) => transitionCampaign(id, action),
  });
  const transitionPending = transitionMutation.isPending;
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

  /**
   * 状态动作成功：先取消页面上仍在进行的读取，再写入本次结果。
   * 取消不掉的旧读取会在写入之后落回缓存，把页面覆盖回旧状态，与成功提示矛盾。
   */
  async function applyTransition(next: CampaignDetail, notice: string): Promise<void> {
    await queryClient.cancelQueries({ queryKey: campaignQueryKeys.detail(id) });
    queryClient.setQueryData(campaignQueryKeys.detail(id), next);
    void queryClient.invalidateQueries({ queryKey: campaignQueryKeys.lists });
    setTransitionError(undefined);
    setTransitionNotice(notice);
  }

  function handleTransitionFailure(error: unknown): void {
    if (isSessionExpired(error)) return;
    setTransitionNotice(undefined);
    setTransitionError({
      message: getWriteErrorMessage(error),
      code: error instanceof ApiError ? error.code : undefined,
    });
  }

  /** 状态动作成功后原按钮可能消失：确认框关闭时把焦点放到仍可操作的位置。 */
  function focusAfterTransition(): void {
    if (document.activeElement !== null && document.activeElement !== document.body) return;
    const nextAction = actionsRef.current?.querySelector('button');
    (nextAction ?? backButtonRef.current)?.focus();
  }

  /** 四个状态动作只有文案和危险标记不同，确认、提交与失败处理共用一套。 */
  function confirmTransition(config: TransitionConfirm): void {
    if (transitionPending) return;
    setTransitionError(undefined);
    Modal.confirm({
      title: config.title,
      content: config.content,
      okText: config.okText,
      cancelText: config.cancelText,
      ...(config.danger ? { okButtonProps: { danger: true } } : {}),
      afterClose: focusAfterTransition,
      onOk: async () => {
        try {
          const updated = await transitionMutation.mutateAsync(config.action);
          await applyTransition(updated, config.notice);
        } catch (error) {
          handleTransitionFailure(error);
        }
      },
    });
  }

  function confirmStart(): void {
    confirmTransition({
      action: 'start',
      title: '启动活动？',
      content: '启动后，活动资料和旅程将不能修改。未发布的内容不会应用。',
      okText: '启动活动',
      cancelText: '暂不启动',
      notice: '活动已启动',
    });
  }

  function confirmPause(): void {
    confirmTransition({
      action: 'pause',
      title: '暂停活动？',
      content:
        '暂停后可修改活动资料，新建或调整旅程；只能删除从未发布过的旅程。未发布内容不会应用。',
      okText: '暂停活动',
      cancelText: '继续运行',
      notice: '活动已暂停',
    });
  }

  function confirmResume(): void {
    confirmTransition({
      action: 'resume',
      title: '恢复活动？',
      content: '恢复后，活动资料和旅程将不能修改。未发布的内容不会应用。',
      okText: '恢复活动',
      cancelText: '保持暂停',
      notice: '活动已恢复',
    });
  }

  function confirmStop(): void {
    confirmTransition({
      action: 'stop',
      title: '停止活动？',
      content: '停止后不能再次启动或恢复，活动与旅程将保持只读。',
      okText: '停止活动',
      cancelText: campaign?.status === 'paused' ? '保持暂停' : '继续运行',
      notice: '活动已停止',
      danger: true,
    });
  }

  return (
    <section aria-label="活动详情" style={{ maxWidth: 960, margin: '0 auto' }}>
      <Flex vertical gap={16}>
        <PageHeader
          back={
            <Button
              ref={backButtonRef}
              type="link"
              style={{ paddingInline: 0 }}
              onClick={() => navigate(`/campaigns${returnTo}`)}
            >
              返回活动列表
            </Button>
          }
          title={campaign?.name ?? '活动详情'}
          actions={
            campaign === undefined ? undefined : (
              <div ref={actionsRef}>
                <Flex gap={8} wrap>
                  {campaign.status === 'draft' && (
                    <Button
                      type="primary"
                      disabled={deleteMutation.isPending || transitionPending}
                      onClick={confirmStart}
                    >
                      启动活动
                    </Button>
                  )}
                  {campaign.status === 'running' && (
                    <Button disabled={transitionPending} onClick={confirmPause}>
                      暂停活动
                    </Button>
                  )}
                  {campaign.status === 'paused' && (
                    <Button type="primary" disabled={transitionPending} onClick={confirmResume}>
                      恢复活动
                    </Button>
                  )}
                  {canEditCampaign(campaign.status) && (
                    <Button
                      ref={editButtonRef}
                      disabled={deleteMutation.isPending || transitionPending}
                      onClick={() => setEditOpen(true)}
                    >
                      编辑活动
                    </Button>
                  )}
                  {(campaign.status === 'running' || campaign.status === 'paused') && (
                    <Button danger disabled={transitionPending} onClick={confirmStop}>
                      停止活动
                    </Button>
                  )}
                  {campaign.status === 'draft' && (
                    <Button
                      danger
                      disabled={deleteMutation.isPending || transitionPending}
                      onClick={() => confirmDelete(campaign)}
                    >
                      删除活动
                    </Button>
                  )}
                </Flex>
              </div>
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

          {transitionNotice && (
            <Alert
              style={{ marginBottom: 16 }}
              type="success"
              showIcon
              title={transitionNotice}
              closable={{ onClose: () => setTransitionNotice(undefined) }}
            />
          )}

          {transitionError && (
            <Alert
              style={{ marginBottom: 16 }}
              type="error"
              showIcon
              title={transitionError.message}
              action={
                transitionError.code === 'CAMPAIGN_HAS_NO_PUBLISHED_JOURNEY' ? (
                  <Button type="link" href="#journeys">
                    查看旅程
                  </Button>
                ) : transitionError.code === 'CAMPAIGN_INVALID_TRANSITION' ||
                  transitionError.code === 'CAMPAIGN_NOT_EDITABLE' ||
                  transitionError.code === 'TIMEOUT' ? (
                  <Button type="link" onClick={() => void refreshDetail()}>
                    刷新状态
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

      <Alert
        style={{ marginTop: 16 }}
        type="info"
        showIcon
        title="当前仅支持活动状态管理，暂不自动运行旅程或发送消息。"
      />

      {campaign !== undefined && (
        <CampaignJourneysSection campaignId={campaign.id} campaignStatus={campaign.status} />
      )}

      {campaign !== undefined && (
        <CampaignFormDrawer
          open={editOpen}
          campaign={campaign}
          onCancel={() => {
            setEditOpen(false);
            // 抽屉打开期间活动可能已在别处启动或停止：关闭后按真实状态刷新页面入口。
            void refreshDetail();
          }}
          onSaved={handleSaved}
          restoreFocus={() => editButtonRef.current?.focus()}
        />
      )}
    </section>
  );
}
