import type { UseQueryResult } from '@tanstack/react-query';
import {
  EXECUTION_STATUSES,
  type JourneyVersionNodeStats,
  type JourneyVersionStats,
} from '@journeylens/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Flex,
  Spin,
  Statistic,
  Table,
  Typography,
  theme,
  type TableProps,
} from 'antd';
import {
  executionStatusBadges,
  executionStatusLabels,
} from '@/features/executions/execution-status';
import { journeyNodeTypeLabels } from '@/features/journeys/journey-node-options';
import { tableScrollX } from '@/utils/table-scroll';
import styles from './JourneyVersionStatsSection.module.css';

/** 分支分布只对条件节点与等待行为节点有意义，两类计数来自步骤记录。 */
export function branchText(node: JourneyVersionNodeStats): string {
  if (node.conditionBranch !== null) {
    return `满足 ${node.conditionBranch.met} / 不满足 ${node.conditionBranch.unmet}`;
  }
  if (node.waitOutcome !== null) {
    return `等到行为 ${node.waitOutcome.matched} / 超时 ${node.waitOutcome.timeout}`;
  }
  return '—';
}

type Query = UseQueryResult<JourneyVersionStats>;

type SummaryProps = { query: Query };

export function JourneyVersionStatsSummary({ query }: SummaryProps) {
  const { token } = theme.useToken();
  const stats = query.data;
  const completionRatio =
    stats === undefined || stats.executionCount === 0
      ? undefined
      : Math.round((stats.statusCounts.completed / stats.executionCount) * 100);

  if (stats === undefined && query.isPending) {
    return (
      <Card className={styles.summaryCard ?? ''}>
        <Flex justify="center" role="status" aria-label="正在读取运行统计">
          <Spin />
        </Flex>
      </Card>
    );
  }

  if (stats === undefined) {
    return (
      <Alert
        type="error"
        showIcon
        title="运行统计暂时无法读取，请重试"
        action={<Button onClick={() => void query.refetch()}>重试</Button>}
      />
    );
  }

  return (
    <Card className={styles.summaryCard ?? ''} styles={{ body: { padding: '12px 16px' } }}>
      {query.error !== null && (
        <Alert
          className={styles.refreshWarning ?? ''}
          type="warning"
          showIcon
          title="运行统计暂时无法刷新，当前数字可能不是最新的"
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      )}
      <div className={styles.summaryGrid} aria-label="版本运行汇总">
        <div className={styles.summaryMetric ?? ''}>
          <Typography.Text type="secondary" className={styles.metricTitle ?? ''}>
            执行次数
          </Typography.Text>
          <Statistic
            value={stats.executionCount}
            styles={{ content: { color: token.colorText } }}
          />
        </div>
        <div className={styles.summaryMetric ?? ''}>
          <Typography.Text type="secondary" className={styles.metricTitle ?? ''}>
            参与用户数
          </Typography.Text>
          <Statistic value={stats.audienceCount} styles={{ content: { color: token.colorText } }} />
        </div>
        {EXECUTION_STATUSES.map((status) => (
          <div key={status} className={styles.summaryMetric ?? ''}>
            <Badge
              status={executionStatusBadges[status]}
              className={styles.statusDot ?? ''}
              aria-hidden
            />
            <Typography.Text className={styles.metricTitle ?? ''}>
              {executionStatusLabels[status]}
            </Typography.Text>
            <Statistic
              value={stats.statusCounts[status]}
              styles={{ content: { color: token.colorText } }}
            />
            {status === 'completed' && completionRatio !== undefined && (
              <Typography.Text type="secondary" className={styles.ratio ?? ''}>
                当前已完成占比 {completionRatio}%
              </Typography.Text>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

type TableSectionProps = {
  query: Query;
  nodes: JourneyVersionNodeStats[];
  onLocate: (nodeId: string) => void;
};

export function JourneyVersionStatsTable({ query, nodes, onLocate }: TableSectionProps) {
  const columns: NonNullable<TableProps<JourneyVersionNodeStats>['columns']> = [
    {
      title: '步骤',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (name: string, node) => (
        <Button className={styles.stepLink ?? ''} type="link" onClick={() => onLocate(node.nodeId)}>
          {name}
        </Button>
      ),
    },
    {
      title: '类型',
      key: 'nodeType',
      width: 100,
      align: 'center',
      render: (_, node) => journeyNodeTypeLabels[node.nodeType],
    },
    { title: '进入', dataIndex: 'entered', key: 'entered', width: 80, align: 'center' },
    {
      title: '已完成',
      key: 'completed',
      width: 180,
      align: 'center',
      render: (_, node) =>
        node.nodeType === 'message' ? `消息触达 ${node.completed} 次` : node.completed,
    },
    { title: '当前等待中', dataIndex: 'waiting', key: 'waiting', width: 110, align: 'center' },
    { title: '失败', dataIndex: 'failed', key: 'failed', width: 80, align: 'center' },
    { title: '已停止', dataIndex: 'stopped', key: 'stopped', width: 90, align: 'center' },
    {
      title: '分支分布',
      key: 'branch',
      width: 180,
      align: 'center',
      render: (_, node) => branchText(node),
    },
  ];

  if (query.data === undefined) {
    return (
      <Flex className={styles.tableStatus ?? ''} justify="center" align="center" role="status">
        {query.isPending ? (
          <Spin aria-label="正在读取步骤统计" />
        ) : (
          <Empty description="统计暂时无法读取" />
        )}
      </Flex>
    );
  }

  return (
    <div className={styles.tablePanel}>
      {query.data.executionCount === 0 && (
        <Typography.Text className={styles.emptyNote ?? ''} type="secondary">
          该版本还没有执行记录
        </Typography.Text>
      )}
      {/* 明细按全部步骤自然展开，纵向阅读交给页面；列较多时保留横向滚动。 */}
      <Table<JourneyVersionNodeStats>
        size="small"
        columns={columns}
        dataSource={nodes}
        rowKey="nodeId"
        pagination={false}
        scroll={{ x: tableScrollX(columns) }}
        locale={{ emptyText: <Empty description="没有找到匹配的步骤" /> }}
      />
    </div>
  );
}
