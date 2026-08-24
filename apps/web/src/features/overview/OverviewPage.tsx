import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CAMPAIGN_STATUSES, type CampaignStatus, type Overview } from '@journeylens/shared';
import {
  ArrowRightOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  RightOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Flex,
  Skeleton,
  Statistic,
  Table,
  Tooltip,
  Typography,
  message,
  theme,
  type TableProps,
} from 'antd';
import { Link } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { campaignStatusBadges, campaignStatusLabels } from '@/features/campaigns/campaign-status';
import { isSessionExpired } from '@/services/api';
import { getOverview } from '@/services/overview';
import { formatDateTime } from '@/utils/format-date-time';
import styles from './OverviewPage.module.css';

const updatedAtFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const shortDateFormatter = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' });

// 页面在前台时每 30 秒静默更新一次；窗口失焦由 TanStack 默认暂停轮询。
const REFRESH_INTERVAL_MS = 30_000;

type Metric = {
  label: string;
  value: number;
  unit: string;
  href?: string;
  help?: string;
  danger?: boolean;
};

function failureRecordsPath(overview: Overview, campaignId?: string): string {
  const params = new URLSearchParams({
    ...(campaignId === undefined ? {} : { campaignId }),
    status: 'failed',
    endedFrom: overview.windowStartedAt,
    endedTo: overview.windowEndedAt,
  });
  return `/executions?${params.toString()}`;
}

const RING_RADIUS = 50;
const RING_STROKE = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function CampaignStatusRing({
  counts,
  total,
  colors,
  trackColor,
}: {
  counts: Record<CampaignStatus, number>;
  total: number;
  colors: Record<CampaignStatus, string>;
  trackColor: string;
}) {
  const visible = CAMPAIGN_STATUSES.filter((status) => counts[status] > 0);
  const gap = visible.length > 1 ? 2 : 0;
  const arcs: { status: CampaignStatus; length: number; offset: number }[] = [];
  let cursor = 0;
  for (const status of visible) {
    const length = (counts[status] / total) * RING_CIRCUMFERENCE;
    arcs.push({ status, length: Math.max(length - gap, 0.5), offset: cursor });
    cursor += length;
  }

  return (
    <svg
      className={styles.ring}
      viewBox="0 0 120 120"
      role="img"
      aria-label={`活动状态分布，共 ${total} 个活动`}
    >
      <circle
        cx="60"
        cy="60"
        r={RING_RADIUS}
        fill="none"
        stroke={trackColor}
        strokeWidth={RING_STROKE}
      />
      {arcs.map((arc) => (
        <circle
          key={arc.status}
          cx="60"
          cy="60"
          r={RING_RADIUS}
          fill="none"
          stroke={colors[arc.status]}
          strokeWidth={RING_STROKE}
          strokeDasharray={`${arc.length} ${RING_CIRCUMFERENCE}`}
          strokeDashoffset={-arc.offset}
          transform="rotate(-90 60 60)"
        />
      ))}
    </svg>
  );
}

export function OverviewPage() {
  const { token } = theme.useToken();
  const [messageApi, messageContextHolder] = message.useMessage();
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const query = useQuery({
    queryKey: ['overview'],
    queryFn: ({ signal }) => getOverview(signal),
    refetchInterval: (current) => (current.state.data === undefined ? false : REFRESH_INTERVAL_MS),
  });
  const data = query.data;
  // 首次读取期间用骨架占住卡片位置，数据到达后布局不跳动；读取失败时骨架让位给错误提示。
  const pending = data === undefined && query.isPending;
  const retry = <Button onClick={() => void query.refetch()}>重试</Button>;
  const sessionExpired = query.error !== null && isSessionExpired(query.error);

  async function refreshOverview(): Promise<void> {
    setManualRefreshing(true);
    const result = await query.refetch();
    setManualRefreshing(false);
    if (result.isSuccess) void messageApi.success('数据已刷新');
  }

  const metrics: Metric[] =
    data === undefined
      ? []
      : [
          {
            label: '当前进行中活动',
            value: data.campaignStatusCounts.running,
            unit: '个',
            href: '/campaigns?status=running',
          },
          {
            label: '近 7 天进入旅程',
            value: data.entryCount,
            unit: '次',
            href: `/executions?${new URLSearchParams({ createdFrom: data.windowStartedAt, createdTo: data.windowEndedAt })}`,
            help: '按进入旅程的时间统计，同一用户多次参与分别计数。',
          },
          {
            label: '近 7 天目标达成',
            value: data.goalReachedCount,
            unit: '次',
            help: '统计近 7 天达成活动目标的次数，按达成时间计算；同一用户多次达成分别计数。',
          },
          {
            label: '近 7 天执行失败',
            value: data.failedCount,
            unit: '次',
            href: failureRecordsPath(data),
            help: '按执行结束的时间统计，较早进入、近 7 天才失败的执行也计入。',
            danger: true,
          },
        ];

  const ringColors: Record<CampaignStatus, string> = {
    draft: token.colorTextPlaceholder,
    running: token.colorSuccess,
    paused: token.colorWarning,
    stopped: token.colorError,
  };

  const campaignTotal =
    data === undefined
      ? 0
      : Object.values(data.campaignStatusCounts).reduce((sum, count) => sum + count, 0);
  const columns: NonNullable<TableProps<Overview['recentCampaigns'][number]>['columns']> = [
    {
      title: '活动名称',
      dataIndex: 'name',
      width: '34%',
      render: (name: string, row) => (
        <Link to={`/campaigns/${row.id}`} style={{ fontWeight: 600 }}>
          {name}
        </Link>
      ),
    },
    {
      title: '当前状态',
      dataIndex: 'status',
      width: '18%',
      render: (status: Overview['recentCampaigns'][number]['status']) => (
        <Badge status={campaignStatusBadges[status]} text={campaignStatusLabels[status]} />
      ),
    },
    { title: '进入次数', dataIndex: 'entryCount', align: 'right', width: '16%' },
    {
      title: '目标达成',
      dataIndex: 'goalReachedCount',
      align: 'right',
      width: '16%',
      render: (value: number | null) =>
        value === null ? <Typography.Text type="secondary">未设置</Typography.Text> : value,
    },
    {
      title: '失败次数',
      dataIndex: 'failedCount',
      align: 'right',
      width: '16%',
      render: (value: number, row) =>
        value > 0 && data !== undefined ? (
          <Link
            to={failureRecordsPath(data, row.id)}
            aria-label={`${row.name}失败 ${value} 次，查看执行记录`}
            style={{ color: token.colorError }}
          >
            {value}
          </Link>
        ) : (
          value
        ),
    },
  ];

  return (
    <section aria-label="运营概览" className={styles.page}>
      {messageContextHolder}
      <div className={styles.header}>
        <PageHeader title="运营概览" />
        <div className={styles.headerActions}>
          <Flex align="center" justify="flex-end" gap={16} wrap>
            {data !== undefined && (
              <Typography.Text
                type="secondary"
                title={`${formatDateTime(data.windowStartedAt)} — ${formatDateTime(data.windowEndedAt)}`}
              >
                近 7 天 ·{' '}
                <time dateTime={data.windowStartedAt}>
                  {new Date(data.windowStartedAt).toLocaleDateString('zh-CN')}
                </time>{' '}
                —{' '}
                <time dateTime={data.windowEndedAt}>
                  {new Date(data.windowEndedAt).toLocaleDateString('zh-CN')}
                </time>
              </Typography.Text>
            )}
            <Button
              icon={<ReloadOutlined aria-hidden />}
              loading={manualRefreshing}
              onClick={() => void refreshOverview()}
            >
              刷新数据
            </Button>
          </Flex>
          {data !== undefined && (
            <Typography.Text type="secondary" className={styles.updatedAt ?? ''}>
              <time dateTime={data.windowEndedAt} title={formatDateTime(data.windowEndedAt)}>
                更新于 {updatedAtFormatter.format(new Date(data.windowEndedAt))}
              </time>
            </Typography.Text>
          )}
        </div>
      </div>

      {!sessionExpired && query.error !== null && (
        <Alert
          showIcon
          type={data === undefined ? 'error' : 'warning'}
          title={
            data === undefined
              ? '概览暂时无法读取，请重试'
              : '概览暂时无法刷新，当前数字可能不是最新的'
          }
          action={retry}
        />
      )}

      {pending && (
        <Card styles={{ body: { padding: 0 } }} classNames={{ body: styles.metrics ?? '' }}>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className={styles.metric}>
              <Skeleton.Input active size="small" style={{ width: 112 }} />
              <div className={styles.metricValue}>
                <Skeleton.Input active size="large" style={{ width: 88 }} />
              </div>
            </div>
          ))}
        </Card>
      )}

      {data !== undefined && (
        <Card styles={{ body: { padding: 0 } }} classNames={{ body: styles.metrics ?? '' }}>
          {metrics.map((metric) => {
            const statistic = (
              <Statistic
                value={metric.value}
                suffix={<span className={styles.unit}>{metric.unit}</span>}
                styles={{
                  content: {
                    fontSize: 40,
                    fontWeight: 600,
                    lineHeight: 1.2,
                    color: metric.danger ? token.colorError : token.colorText,
                  },
                }}
              />
            );
            return (
              <div key={metric.label} className={styles.metric}>
                <Flex align="center" gap={2}>
                  <Typography.Text style={{ color: token.colorTextSecondary }}>
                    {metric.label}
                  </Typography.Text>
                  {metric.help !== undefined && (
                    <Tooltip title={metric.help} trigger={['hover', 'focus']}>
                      <Button
                        type="text"
                        size="small"
                        aria-label={`${metric.label}说明`}
                        icon={<InfoCircleOutlined aria-hidden />}
                        style={{ color: token.colorTextTertiary }}
                      />
                    </Tooltip>
                  )}
                </Flex>
                <div className={styles.metricValue}>
                  {metric.href === undefined ? (
                    statistic
                  ) : (
                    <Link
                      className={styles.metricLink}
                      to={metric.href}
                      aria-label={`${metric.label} ${metric.value} ${metric.unit}，查看记录`}
                    >
                      {statistic}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <div className={styles.mainGrid}>
        <Card
          className={styles.recentCard ?? ''}
          classNames={{ body: styles.recentBody ?? '' }}
          title={
            <Flex vertical gap={4}>
              <span>近期活动</span>
              <Typography.Text type="secondary" className={styles.sectionDescription ?? ''}>
                按最近一次进入旅程排序，次数按近 7 天统计
              </Typography.Text>
            </Flex>
          }
          styles={{
            header: { borderBottom: 0, minHeight: 80, fontSize: 18 },
            body: { paddingTop: 0 },
          }}
          extra={
            <Link to="/campaigns">
              查看全部活动 <ArrowRightOutlined aria-hidden />
            </Link>
          }
        >
          {data === undefined ? (
            pending ? (
              <div className={styles.tableSkeleton} role="status" aria-label="正在读取概览">
                <Skeleton active title={false} paragraph={{ rows: 5 }} />
              </div>
            ) : (
              <Flex className={styles.loading} justify="center">
                <Typography.Text type="secondary">近期活动暂时无法读取</Typography.Text>
              </Flex>
            )
          ) : (
            <Table
              rowKey="id"
              columns={columns}
              dataSource={data.recentCampaigns}
              pagination={false}
              scroll={{ x: 615 }}
              locale={{ emptyText: <Empty description="近 7 天还没有进入旅程的记录" /> }}
            />
          )}
        </Card>
        <div className={styles.sideColumn}>
          {pending && (
            <Card
              title="活动概况"
              styles={{ header: { fontSize: 18, minHeight: 48 }, body: { padding: '16px 24px' } }}
            >
              <div className={styles.statusChart}>
                <div className={styles.ringWrap}>
                  <Skeleton.Avatar active shape="circle" size={148} />
                </div>
                <div className={styles.statusLegend}>
                  <Skeleton active title={false} paragraph={{ rows: 4 }} />
                </div>
              </div>
            </Card>
          )}
          {data !== undefined && (
            <Card
              title="活动概况"
              styles={{ header: { fontSize: 18, minHeight: 48 }, body: { padding: '16px 24px' } }}
            >
              <div className={styles.statusChart}>
                <div className={styles.ringWrap}>
                  <CampaignStatusRing
                    counts={data.campaignStatusCounts}
                    total={campaignTotal}
                    colors={ringColors}
                    trackColor={token.colorFillSecondary}
                  />
                  <div className={styles.ringCenter}>
                    <Link
                      to="/campaigns"
                      className={styles.ringTotal}
                      aria-label={`活动总数 ${campaignTotal} 个，查看全部活动`}
                    >
                      <span className={styles.ringValue}>{campaignTotal}</span>
                      <Typography.Text type="secondary" className={styles.ringLabel ?? ''}>
                        个活动
                      </Typography.Text>
                    </Link>
                  </div>
                </div>
                <div className={styles.statusLegend}>
                  {CAMPAIGN_STATUSES.map((status) => (
                    <Link
                      key={status}
                      to={`/campaigns?status=${status}`}
                      className={styles.statusLegendRow}
                      aria-label={`${campaignStatusLabels[status]}活动 ${data.campaignStatusCounts[status]} 个，查看活动`}
                    >
                      <Badge
                        status={campaignStatusBadges[status]}
                        text={campaignStatusLabels[status]}
                      />
                      <Typography.Text strong>{data.campaignStatusCounts[status]}</Typography.Text>
                    </Link>
                  ))}
                </div>
              </div>
            </Card>
          )}
          {pending && (
            <Card
              title="近期旅程"
              styles={{ header: { fontSize: 18, minHeight: 48 }, body: { padding: '16px 24px' } }}
              extra={<Typography.Text type="secondary">最新发布</Typography.Text>}
            >
              <Skeleton active title={false} paragraph={{ rows: 3 }} />
            </Card>
          )}
          {data !== undefined && (
            <Card
              title="近期旅程"
              styles={{ header: { fontSize: 18, minHeight: 48 }, body: { padding: '16px 24px' } }}
              extra={<Typography.Text type="secondary">最新发布</Typography.Text>}
            >
              {data.recentJourneys.length === 0 ? (
                <Empty description="还没有发布过的旅程" />
              ) : (
                <div>
                  {data.recentJourneys.map((item) => (
                    <Link
                      key={item.id}
                      to={`/journeys/${item.id}/versions/${item.versionId}`}
                      className={styles.journeyRow}
                      aria-label={`${item.name}，${item.campaign.name}，第 ${item.versionNumber} 版，${formatDateTime(item.publishedAt)} 发布，查看版本运行情况`}
                    >
                      <span className={styles.journeyText}>
                        <span className={styles.journeyName}>{item.name}</span>
                        <Typography.Text type="secondary" className={styles.journeyMeta ?? ''}>
                          {item.campaign.name} · 第 {item.versionNumber} 版 ·{' '}
                          {shortDateFormatter.format(new Date(item.publishedAt))}
                        </Typography.Text>
                      </span>
                      <RightOutlined
                        aria-hidden
                        className={styles.journeyChevron}
                        style={{ color: token.colorTextTertiary }}
                      />
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}
