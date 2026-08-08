import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { EXECUTION_STATUSES, type ExecutionStatus } from '@journeylens/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Divider,
  Flex,
  Row,
  Spin,
  Statistic,
  Tooltip,
  theme,
} from 'antd';
import { Link } from 'react-router';
import { ApiError, isSessionExpired } from '@/services/api';
import { getCampaignOverview } from '@/services/campaigns';
import { campaignQueryKeys } from '@/features/campaigns/campaign-queries';
import {
  executionStatusBadges,
  executionStatusLabels,
} from '@/features/executions/execution-status';
import styles from './CampaignOverviewSection.module.css';

type Props = { campaignId: string };

const overviewHelp =
  '按最近一次读取的执行记录统计，可刷新查看变化。点击状态数字查看执行记录；已完成包含流程结束和目标达成后退出。';
const audienceHelp = '同一用户多次进入只计一人';
const goalHelp = '同一用户多次参与分别计数；这是参与达成次数，不代表订单数或实际转化。';

function executionsPath(campaignId: string, status?: ExecutionStatus): string {
  const params = new URLSearchParams({ campaignId });
  if (status !== undefined) params.set('status', status);
  return `/executions?${params.toString()}`;
}

/** 指标标题带口径说明：点击或悬停说明图标后才展开，避免默认占满卡片。 */
function MetricTitle({ text, help }: { text: string; help: string }) {
  return (
    <Flex align="center" gap={4}>
      <span>{text}</span>
      <Tooltip title={help} placement="right" trigger={['hover', 'focus']}>
        <Button
          type="text"
          size="small"
          aria-label={`${text}说明`}
          icon={<InfoCircleOutlined aria-hidden="true" />}
        />
      </Tooltip>
    </Flex>
  );
}

export function CampaignOverviewSection({ campaignId }: Props) {
  const queryClient = useQueryClient();
  const { token } = theme.useToken();
  const query = useQuery({
    queryKey: campaignQueryKeys.overview(campaignId),
    queryFn: ({ signal }) => getCampaignOverview(campaignId, signal),
  });
  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const sessionExpired = query.error !== null && isSessionExpired(query.error);

  useEffect(() => {
    if (notFound) {
      void queryClient.invalidateQueries({ queryKey: campaignQueryKeys.detail(campaignId) });
    }
  }, [campaignId, notFound, queryClient]);

  if (notFound || sessionExpired) return null;

  const retry = <Button onClick={() => void query.refetch()}>重试</Button>;
  // null 表示活动未设置目标，与“有目标但还没有人达成”的 0 区分开。
  const goalReachedCount = query.data?.goalReachedCount ?? null;
  const primaryTitleStyle = { marginBottom: 4, color: token.colorTextSecondary, fontSize: 14 };
  const primaryValueStyle = { fontSize: 30, lineHeight: 1.25 };

  return (
    <Card
      styles={{ root: { flex: 1, minWidth: 0 } }}
      title={<MetricTitle text="运行概览" help={overviewHelp} />}
      extra={
        <Flex align="center" gap={12} wrap>
          <Button
            icon={<ReloadOutlined aria-hidden="true" />}
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            刷新
          </Button>
          <Link to={executionsPath(campaignId)} style={{ fontWeight: 600 }}>
            查看全部执行
          </Link>
        </Flex>
      }
    >
      {query.data === undefined && query.isPending ? (
        <Flex justify="center" role="status" aria-label="正在读取运行概览" style={{ padding: 32 }}>
          <Spin />
        </Flex>
      ) : query.data === undefined ? (
        <Alert type="error" showIcon title="运行概览暂时无法读取，请重试" action={retry} />
      ) : (
        <>
          {query.error !== null && (
            <Alert
              style={{ marginBottom: 16 }}
              type="warning"
              showIcon
              title="运行概览暂时无法刷新，当前数字可能不是最新的"
              action={retry}
            />
          )}

          <Row gutter={[16, 16]} className={styles.primaryMetrics ?? ''}>
            <Col span={12} className={styles.primaryMetric ?? ''}>
              <Link
                className={`${styles.metricLink ?? ''} ${styles.primaryMetricLink ?? ''}`}
                to={executionsPath(campaignId)}
                aria-label={`执行总次数 ${query.data.executionCount}，查看全部执行`}
              >
                <Statistic
                  title="执行总次数"
                  value={query.data.executionCount}
                  styles={{
                    title: primaryTitleStyle,
                    content: { ...primaryValueStyle, color: token.colorPrimary },
                  }}
                />
              </Link>
            </Col>
            <Col span={12} className={styles.primaryMetric ?? ''}>
              <Statistic
                title={<MetricTitle text="参与用户数" help={audienceHelp} />}
                value={query.data.audienceCount}
                styles={{ title: primaryTitleStyle, content: primaryValueStyle }}
              />
            </Col>
          </Row>

          {/* 未设置目标时不显示达成次数，不用 0 表示“没有这个含义”。 */}
          {goalReachedCount !== null && (
            <div className={styles.goalMetric ?? ''}>
              <Statistic
                title={<MetricTitle text="目标达成次数" help={goalHelp} />}
                value={goalReachedCount}
                styles={{
                  title: { marginBottom: 2, color: token.colorTextTertiary, fontSize: 13 },
                  content: { fontSize: 20, lineHeight: 1.25 },
                }}
              />
            </div>
          )}

          <Divider />

          <div className={styles.statusGrid ?? ''}>
            {EXECUTION_STATUSES.map((status) => {
              const label = executionStatusLabels[status];
              const count = query.data.statusCounts[status];

              return (
                <Flex key={status} className={styles.statusMetric ?? ''} vertical gap={8}>
                  <Badge status={executionStatusBadges[status]} text={label} />
                  <Link
                    className={styles.metricLink ?? ''}
                    to={executionsPath(campaignId, status)}
                    aria-label={`${label} ${count}，查看${label}的执行`}
                  >
                    <Statistic
                      value={count}
                      styles={{
                        content: { fontSize: 20, lineHeight: 1.2, color: token.colorPrimary },
                      }}
                    />
                  </Link>
                </Flex>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
