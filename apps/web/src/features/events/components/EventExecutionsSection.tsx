import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Flex,
  Pagination,
  Spin,
  Table,
  Typography,
  type TableProps,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { PAGE_SIZES, type EventRelatedExecution } from '@journeylens/shared';
import { Link } from 'react-router';
import { useListPagination, useSyncListPage } from '@/hooks/use-list-pagination';
import { ApiError, getApiErrorMessage, isSessionExpired } from '@/services/api';
import { getEventExecutions } from '@/services/events';
import { formatDateTime } from '@/utils/format-date-time';
import {
  executionStatusBadges,
  executionStatusLabels,
} from '@/features/executions/execution-status';
import { eventQueryKeys } from '../event-queries';

function executionColumns(): NonNullable<TableProps<EventRelatedExecution>['columns']> {
  return [
    {
      title: '所属活动',
      key: 'campaign',
      width: 180,
      render: (_value, execution) => (
        <Link to={`/campaigns/${execution.campaign.id}`}>{execution.campaign.name}</Link>
      ),
    },
    {
      title: '相关旅程',
      key: 'journey',
      width: 200,
      render: (_value, execution) => (
        <Flex vertical gap={4}>
          <Link to={`/journeys/${execution.journey.id}`}>{execution.journey.name}</Link>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            第 {execution.version.versionNumber} 版 · 进入时间 {formatDateTime(execution.startedAt)}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: '这次行为带来的变化',
      key: 'change',
      width: 330,
      render: (_value, execution) => (
        <Flex vertical gap={4}>
          {execution.enteredByEvent && <Typography.Text>用户进入旅程</Typography.Text>}
          {execution.matchedStep !== null && (
            <Flex vertical gap={2}>
              <Typography.Text>等到该行为，流程进入下一步</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                等待步骤：{execution.matchedStep.nodeName}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                结束等待时间：
                {execution.matchedStep.endedWaitingAt === null
                  ? '未记录'
                  : formatDateTime(execution.matchedStep.endedWaitingAt)}
              </Typography.Text>
            </Flex>
          )}
        </Flex>
      ),
    },
    {
      title: '当前进度',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (status: EventRelatedExecution['status']) => (
        <Badge status={executionStatusBadges[status]} text={executionStatusLabels[status]} />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      fixed: 'end',
      render: (_value, execution) => (
        <Link to={`/executions/${execution.id}`} style={{ fontWeight: 600 }}>
          查看过程
        </Link>
      ),
    },
  ];
}

export function EventExecutionsSection({
  eventId,
  onEventNotFound,
}: {
  eventId: string;
  onEventNotFound: () => void;
}) {
  const { pageParam, pageSizeParam, setPagination } = useListPagination();
  const queryInput = {
    ...(pageParam === undefined ? {} : { page: pageParam }),
    ...(pageSizeParam === undefined ? {} : { pageSize: pageSizeParam }),
  };
  const query = useQuery({
    queryKey: eventQueryKeys.relatedJourneysPage(eventId, pageParam, pageSizeParam),
    queryFn: ({ signal }) => getEventExecutions(eventId, queryInput, signal),
  });
  const list = query.data;
  useSyncListPage(query);

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 404) onEventNotFound();
  }, [onEventNotFound, query.error]);

  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const loadError =
    list === undefined && query.error !== null && !notFound && !isSessionExpired(query.error)
      ? getApiErrorMessage(query.error)
      : undefined;
  const refreshError =
    list !== undefined && query.error !== null && !isSessionExpired(query.error)
      ? '相关旅程暂时无法刷新，当前内容可能不是最新的'
      : undefined;

  return (
    <section aria-label="相关旅程">
      <Card
        title="相关旅程"
        extra={
          <Button
            icon={<ReloadOutlined aria-hidden />}
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            刷新
          </Button>
        }
      >
        <Flex vertical gap={16}>
          {refreshError !== undefined && (
            <Alert
              type="warning"
              showIcon
              title={refreshError}
              action={<Button onClick={() => void query.refetch()}>重试</Button>}
            />
          )}
          {loadError !== undefined && (
            <Alert
              type="error"
              showIcon
              title={loadError}
              action={<Button onClick={() => void query.refetch()}>重试</Button>}
            />
          )}
          {list === undefined && query.isPending && !notFound && (
            <Flex
              justify="center"
              role="status"
              aria-label="正在读取相关旅程"
              style={{ padding: 32 }}
            >
              <Spin />
            </Flex>
          )}
          {list !== undefined && !notFound && (
            <>
              <Table<EventRelatedExecution>
                rowKey="id"
                columns={executionColumns()}
                dataSource={list.data}
                pagination={false}
                scroll={{ x: 980 }}
                tableLayout="fixed"
                size="middle"
                loading={query.isFetching}
                locale={{
                  emptyText: <Empty description="没有记录用户进入旅程或结束等待的相关情况" />,
                }}
              />
              <Flex justify="end">
                <Pagination
                  current={list.page.page}
                  pageSize={list.page.pageSize}
                  total={list.page.total}
                  showSizeChanger={{ id: 'event-journey-page-size', 'aria-label': '每页条数' }}
                  pageSizeOptions={[...PAGE_SIZES]}
                  showQuickJumper
                  disabled={query.isFetching}
                  showTotal={(total) => `共 ${total} 条`}
                  onChange={setPagination}
                />
              </Flex>
            </>
          )}
        </Flex>
      </Card>
    </section>
  );
}
