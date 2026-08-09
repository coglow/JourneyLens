import { useState } from 'react';
import { CloudUploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Descriptions, Flex, Modal, Spin, Tooltip, Typography } from 'antd';
import { Link } from 'react-router';
import type { JourneyVersionDetail } from '@journeylens/shared';
import { ApiError, getWriteErrorMessage, isSessionExpired } from '@/services/api';
import { getJourney, publishJourney } from '@/services/journeys';
import { SegmentRuleView } from '@/features/segments/components/SegmentRuleView';
import { journeyQueryKeys, journeyVersionQueryKeys } from '@/features/journeys/journey-queries';
import styles from './JourneyDraftEditor.module.css';

type Props = {
  journeyId: string;
  /** 编辑器当前已保存内容的修订号；发布只针对这份内容。 */
  revision: number;
  /** 不可发布的原因；为 undefined 时按钮可用。 */
  blockReason: string | undefined;
  /** 发布前发现旅程已被修改时，沿用编辑器现有的“读取最新内容”确认流程。 */
  onReadLatest: () => void;
};

type Conflict = 'journey' | 'segment';

/**
 * 发布确认：打开时重新读取旅程详情，只提交本次确认过的两个修订号。
 */
export function JourneyPublishDialog({ journeyId, revision, blockReason, onReadLatest }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [success, setSuccess] = useState<JourneyVersionDetail>();
  const [publishError, setPublishError] = useState<string>();
  const [conflict, setConflict] = useState<Conflict>();

  const check = useQuery({
    queryKey: journeyQueryKeys.publishCheck(journeyId),
    queryFn: ({ signal }) => getJourney(journeyId, signal),
    enabled: open,
    // 每次打开都重新读取；确认资料只用于本次弹窗，不写回草稿缓存。
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
  const publish = useMutation({
    mutationFn: (input: { revision: number; segmentRevision: number | null }) =>
      publishJourney(journeyId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: journeyVersionQueryKeys.all(journeyId) });
      void queryClient.invalidateQueries({ queryKey: journeyQueryKeys.lists });
    },
  });

  const fresh = check.data;
  const revisionChanged = fresh !== undefined && fresh.revision !== revision;

  function openDialog(): void {
    setSuccess(undefined);
    setPublishError(undefined);
    setConflict(undefined);
    setOpen(true);
  }

  function closeDialog(): void {
    if (publish.isPending) return;
    setOpen(false);
  }

  function readLatest(): void {
    closeDialog();
    onReadLatest();
  }

  async function confirmPublish(): Promise<void> {
    if (publish.isPending || fresh === undefined || revisionChanged) return;
    setPublishError(undefined);
    setConflict(undefined);
    try {
      const version = await publish.mutateAsync({
        revision: fresh.revision,
        segmentRevision: fresh.segment?.revision ?? null,
      });
      setSuccess(version);
    } catch (error) {
      if (isSessionExpired(error)) return;
      if (error instanceof ApiError) {
        if (error.code === 'JOURNEY_REVISION_CONFLICT') {
          setConflict('journey');
          setPublishError('旅程已在其他页面修改，请重新读取后再发布');
          return;
        }
        if (error.code === 'JOURNEY_SEGMENT_REVISION_CONFLICT') {
          setConflict('segment');
          setPublishError('入口分群已修改，请重新确认分群规则后再发布');
          return;
        }
        if (error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR') {
          setPublishError('暂时无法确认发布结果，可重试或查看已发布版本');
          return;
        }
      }
      setPublishError(getWriteErrorMessage(error));
    }
  }

  return (
    <>
      <Tooltip title={blockReason} placement="bottom">
        <span className={styles.disabledButtonTrigger ?? ''}>
          <Button
            icon={<CloudUploadOutlined />}
            aria-label="发布版本"
            disabled={blockReason !== undefined}
            onClick={openDialog}
          >
            发布版本
          </Button>
        </span>
      </Tooltip>
      <Modal
        open={open}
        title={success ? '发布成功' : '发布版本？'}
        width={560}
        okText={success ? '关闭' : '确认发布'}
        cancelText="取消"
        confirmLoading={publish.isPending}
        cancelButtonProps={{
          disabled: publish.isPending,
          ...(success ? { style: { display: 'none' } } : {}),
        }}
        okButtonProps={{
          disabled:
            success === undefined &&
            (fresh === undefined || revisionChanged || check.isError || publish.isPending),
        }}
        mask={{ closable: !publish.isPending }}
        closable={!publish.isPending}
        keyboard={!publish.isPending}
        destroyOnHidden
        onOk={() => (success ? closeDialog() : void confirmPublish())}
        onCancel={closeDialog}
      >
        <Flex vertical gap={12}>
          {success !== undefined ? (
            <>
              <Alert type="success" showIcon title={`已发布第 ${success.versionNumber} 版`} />
              <Typography.Text type="secondary">版本已保存固定内容。</Typography.Text>
              <Link to={`/journeys/${journeyId}/versions/${success.id}`}>查看该版本</Link>
            </>
          ) : check.isPending ? (
            <Flex
              justify="center"
              role="status"
              aria-label="正在读取发布内容"
              style={{ padding: 24 }}
            >
              <Spin />
            </Flex>
          ) : check.isError ? (
            <Alert
              type="error"
              showIcon
              title="暂时无法读取发布内容，请重试"
              action={
                <Button type="link" onClick={() => void check.refetch()}>
                  重试
                </Button>
              }
            />
          ) : fresh !== undefined ? (
            <>
              <Typography.Text>发布后将保存这份内容的固定版本，不会自动启动活动。</Typography.Text>
              <Descriptions bordered column={1} size="small">
                <Descriptions.Item label="旅程名称">{fresh.name}</Descriptions.Item>
                <Descriptions.Item label="旅程说明">
                  {fresh.description ?? '未填写'}
                </Descriptions.Item>
                <Descriptions.Item label="入口分群">
                  {fresh.segment?.name ?? '不限人群'}
                </Descriptions.Item>
              </Descriptions>
              {fresh.segment !== null && (
                <Flex vertical gap={8}>
                  <Typography.Text strong>分群规则</Typography.Text>
                  <SegmentRuleView rules={fresh.segment.rules} />
                </Flex>
              )}
              {revisionChanged && (
                <Alert
                  type="warning"
                  showIcon
                  title="旅程已在其他页面修改，请重新读取后再发布"
                  action={
                    <Button type="link" onClick={readLatest}>
                      读取最新内容
                    </Button>
                  }
                />
              )}
            </>
          ) : null}

          {publishError !== undefined && (
            <Alert
              type="error"
              showIcon
              title={publishError}
              action={
                conflict === 'journey' ? (
                  <Button type="link" onClick={readLatest}>
                    读取最新内容
                  </Button>
                ) : conflict === 'segment' ? (
                  <Button type="link" onClick={() => void check.refetch()}>
                    重新读取
                  </Button>
                ) : undefined
              }
            />
          )}
        </Flex>
      </Modal>
    </>
  );
}
