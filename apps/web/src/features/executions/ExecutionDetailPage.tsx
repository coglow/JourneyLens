import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Flex,
  Popover,
  Spin,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import {
  JOURNEY_EVENT_TYPE_LABELS,
  JOURNEY_MESSAGE_CHANNELS,
  journeyEventFields,
  type ExecutionTrace,
} from '@journeylens/shared';
import { useLocation, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { ApiError, getApiErrorMessage, isSessionExpired } from '@/services/api';
import { getExecutionTrace } from '@/services/executions';
import { formatDateTime } from '@/utils/format-date-time';
import { campaignGoalText } from '@/features/campaigns/campaign-goal';
import { formatWaitDuration } from '@/features/journeys/journey-wait';
import { executionQueryKeys } from './execution-queries';
import { executionStatusBadges, executionStatusLabels } from './execution-status';
import { ExecutionStepTrail } from './components/ExecutionStepTrail';
import styles from './ExecutionDetailPage.module.css';

function eventValueText(
  field: { values?: readonly { value: string; label: string }[] },
  value: unknown,
) {
  if (Array.isArray(value)) return value.join('、');
  return field.values?.find((item) => item.value === value)?.label ?? String(value);
}

function readReturnTo(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('returnTo' in state)) return '';
  const returnTo = state.returnTo;
  return typeof returnTo === 'string' && returnTo.startsWith('?') ? returnTo : '';
}

/** 摘要只取已保存的状态、结束说明和成功消息，不把等待或失败推断为已完成。 */
function outcomeText(trace: ExecutionTrace): string {
  if (trace.status === 'failed') return trace.failureReason ?? '执行未能继续，请查看失败步骤。';
  if (trace.status === 'stopped') return '活动已停止，尚未结束的步骤已终止。';
  // 达成目标是“已完成”的一种，但结束原因来自目标事实，不来自结束节点。
  if (trace.goal?.reachedAt != null) return '目标已达成，已退出旅程。';
  if (trace.status === 'waiting')
    return `正在「${trace.currentNode?.name ?? '等待步骤'}」等待，符合条件后继续。`;
  if (trace.status === 'running') return `正在运行「${trace.currentNode?.name ?? '开始步骤'}」。`;
  const end = trace.steps.findLast((step) => step.output.kind === 'end');
  const message = trace.steps.findLast(
    (step) => step.status === 'succeeded' && step.output.kind === 'message',
  );
  const result = end?.output.kind === 'end' ? (end.output.note ?? '流程已结束') : '流程已结束';
  if (message?.output.kind !== 'message') return result;
  const channelValue = message.output.channel;
  const channel = JOURNEY_MESSAGE_CHANNELS.find((item) => item.value === channelValue)?.label;
  return `${result} · 已执行${channel}消息（演示发送）`;
}

export function ExecutionDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: executionQueryKeys.trace(id),
    queryFn: ({ signal }) => getExecutionTrace(id, signal),
    // 只在可见页面刷新未结束执行，展开状态由稳定组件保留。
    refetchInterval: (current) => {
      const status = current.state.data?.status;
      if (status !== 'running' && status !== 'waiting') return false;
      return document.visibilityState === 'visible' ? 3000 : false;
    },
  });
  const trace = query.data;
  const refetch = query.refetch;
  useEffect(() => {
    function handleVisibilityChange(): void {
      if (document.visibilityState === 'visible') void refetch();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refetch]);

  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const loadError =
    trace === undefined && query.error !== null && !notFound && !isSessionExpired(query.error)
      ? getApiErrorMessage(query.error)
      : undefined;
  const refreshError =
    trace !== undefined && query.error !== null && !isSessionExpired(query.error)
      ? '执行记录暂时无法刷新，当前内容可能不是最新的'
      : undefined;
  const returnTo = readReturnTo(location.state);
  const active = trace?.status === 'running' || trace?.status === 'waiting';
  const deadline = trace?.steps.find((step) => step.status === 'waiting')?.deadlineAt;

  // 目标证据只读已保存的事实：配置来自活动固定目标，达成时间来自目标行为。
  const goal = trace?.goal ?? null;
  const goalEvent = goal?.event ?? null;
  const goalReached = goal?.reachedAt != null;
  const goalItems =
    goal === null
      ? []
      : [
          { key: 'target', label: '目标', children: campaignGoalText(goal) },
          {
            key: 'reached',
            label: '达成情况',
            children: goal.reachedAt === null ? '尚未达成' : '已达成',
          },
          ...(goal.reachedAt === null
            ? []
            : [
                {
                  key: 'reachedAt',
                  label: '目标行为接收时间',
                  children: formatDateTime(goal.reachedAt),
                },
              ]),
          ...(trace?.endedAt == null
            ? []
            : [
                {
                  key: 'endedAt',
                  label: '执行结束时间',
                  children: formatDateTime(trace.endedAt),
                },
              ]),
          ...(goalEvent === null
            ? []
            : [
                {
                  key: 'eventType',
                  label: '达成行为',
                  children: <Tag color="blue">{JOURNEY_EVENT_TYPE_LABELS[goalEvent.type]}</Tag>,
                },
                ...journeyEventFields(goalEvent.type).flatMap((field) => {
                  const value = goalEvent.payload[field.key];
                  return value == null
                    ? []
                    : [
                        {
                          key: field.key,
                          label: field.label,
                          children: eventValueText(field, value),
                        },
                      ];
                }),
              ]),
        ];

  return (
    <section aria-label="执行轨迹" className={styles.page}>
      <Flex vertical gap={16}>
        <PageHeader
          back={
            <Button
              type="link"
              className={styles.backButton ?? ''}
              onClick={() => navigate(`/executions${returnTo}`)}
            >
              返回执行记录
            </Button>
          }
          title={
            trace === undefined ? (
              '执行轨迹'
            ) : (
              <span className={styles.title}>
                {trace.audience.displayName}的执行轨迹
                <Tag color={executionStatusBadges[trace.status]}>
                  {executionStatusLabels[trace.status]}
                </Tag>
              </span>
            )
          }
          actions={
            trace === undefined ? undefined : (
              <Button
                aria-label="查看该发布版本"
                onClick={() =>
                  navigate(`/journeys/${trace.journey.id}/versions/${trace.version.id}`)
                }
              >
                查看流程 v{trace.version.versionNumber}
              </Button>
            )
          }
        />
        {refreshError !== undefined && (
          <Alert
            type="warning"
            showIcon
            title={refreshError}
            action={<Button onClick={() => void query.refetch()}>重试</Button>}
          />
        )}
        {notFound && <Alert type="warning" showIcon title="执行记录不存在" />}
        {loadError !== undefined && (
          <Alert
            type="error"
            showIcon
            title={loadError}
            action={<Button onClick={() => void query.refetch()}>重试</Button>}
          />
        )}
        {trace === undefined && query.isPending && !notFound && (
          <Flex
            justify="center"
            role="status"
            aria-label="正在读取执行轨迹"
            className={styles.loading ?? ''}
          >
            <Spin />
          </Flex>
        )}
        {trace !== undefined && (
          <>
            <Card>
              <Flex
                justify="space-between"
                align="flex-start"
                gap={16}
                wrap
                className={styles.summaryHeader}
              >
                <Typography.Title level={4} className={styles.summaryTitle ?? ''}>
                  旅程名称：{trace.journey.name}
                </Typography.Title>
                <Popover
                  trigger={['hover', 'focus']}
                  title="执行信息"
                  content={
                    <Descriptions column={1} size="small">
                      <Descriptions.Item label="用户 ID">
                        {trace.audience.externalId}
                      </Descriptions.Item>
                      <Descriptions.Item label="创建时间">
                        {formatDateTime(trace.createdAt)}
                      </Descriptions.Item>
                      <Descriptions.Item label="版本发布时间">
                        {formatDateTime(trace.version.publishedAt)}
                      </Descriptions.Item>
                      <Descriptions.Item label={active ? '当前步骤' : '结束于'}>
                        {/* 目标退出保留原指针；指针为空时说明没有记录位置，不断言从未执行。 */}
                        {trace.currentNode?.name ?? (goalReached ? '未记录位置' : '尚未开始')}
                      </Descriptions.Item>
                    </Descriptions>
                  }
                >
                  <Button type="text" size="small" icon={<InfoCircleOutlined aria-hidden />}>
                    执行信息
                  </Button>
                </Popover>
              </Flex>
              {/* 时间与数量分别标注；执行结束后才计算总历时，保留原有统计口径。 */}
              <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                <Descriptions.Item label="所属活动">
                  <Button
                    type="link"
                    className={styles.inlineLink ?? ''}
                    onClick={() => navigate(`/campaigns/${trace.campaign.id}`)}
                  >
                    {trace.campaign.name}
                  </Button>
                </Descriptions.Item>
                <Descriptions.Item label="旅程版本">
                  第 {trace.version.versionNumber} 版
                </Descriptions.Item>
                <Descriptions.Item label="开始时间">
                  {formatDateTime(trace.startedAt)}
                </Descriptions.Item>
                <Descriptions.Item label="结束时间">
                  {trace.endedAt === null ? '尚未结束' : formatDateTime(trace.endedAt)}
                </Descriptions.Item>
                <Descriptions.Item label="步骤数量">{trace.steps.length} 个</Descriptions.Item>
                <Descriptions.Item label="总历时">
                  {trace.endedAt === null
                    ? '—'
                    : formatWaitDuration(
                        Math.max(
                          0,
                          Math.round(
                            (Date.parse(trace.endedAt) - Date.parse(trace.startedAt)) / 1000,
                          ),
                        ),
                      )}
                </Descriptions.Item>
                {deadline != null && (
                  <Descriptions.Item label="等待截止" span="filled">
                    {formatDateTime(deadline)}
                  </Descriptions.Item>
                )}
                <Descriptions.Item
                  label={trace.status === 'failed' ? '失败原因' : active ? '当前进展' : '结束结果'}
                  span="filled"
                  className={styles.breakable ?? ''}
                >
                  <span className={trace.status === 'failed' ? styles.failed : undefined}>
                    {outcomeText(trace)}
                  </span>
                </Descriptions.Item>
              </Descriptions>
              {active && <Typography.Text type="secondary">每 3 秒自动刷新</Typography.Text>}
              {goalItems.length > 0 && (
                <Descriptions
                  className={styles.goal ?? ''}
                  title="活动目标"
                  size="small"
                  column={{ xs: 1, sm: 2 }}
                  items={goalItems}
                />
              )}
            </Card>
            <Card styles={{ body: { padding: '0 24px 20px' } }}>
              <Tabs
                defaultActiveKey="trail"
                items={[
                  {
                    key: 'trail',
                    label: '执行轨迹',
                    children: (
                      <ExecutionStepTrail
                        key={trace.id}
                        steps={trace.steps}
                        audienceName={trace.audience.displayName}
                        entryEvidence={trace.entryEvidence}
                        goalReached={goalReached}
                      />
                    ),
                  },
                  {
                    key: 'trigger',
                    label: '触发行为',
                    children: (
                      <div className={styles.trigger}>
                        <Typography.Title level={4}>
                          本次执行的触发行为{' '}
                          <Tag color="blue">
                            {JOURNEY_EVENT_TYPE_LABELS[trace.triggerEvent.type]}
                          </Tag>
                        </Typography.Title>
                        <Descriptions column={{ xs: 1, sm: 2 }} size="middle">
                          <Descriptions.Item label="关联用户">
                            {trace.audience.displayName}
                          </Descriptions.Item>
                          <Descriptions.Item label="接收时间">
                            {formatDateTime(trace.triggerEvent.receivedAt)}
                          </Descriptions.Item>
                          {journeyEventFields(trace.triggerEvent.type).map((field) => {
                            const value = trace.triggerEvent.payload[field.key];
                            return value == null ? null : (
                              <Descriptions.Item key={field.key} label={field.label}>
                                {eventValueText(field, value)}
                              </Descriptions.Item>
                            );
                          })}
                        </Descriptions>
                        <Typography.Paragraph type="secondary" className={styles.eventId ?? ''}>
                          行为 ID：
                          <Typography.Text copyable className={styles.breakable ?? ''}>
                            {trace.triggerEvent.id}
                          </Typography.Text>
                        </Typography.Paragraph>
                      </div>
                    ),
                  },
                ]}
              />
            </Card>
          </>
        )}
      </Flex>
    </section>
  );
}
