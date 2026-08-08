import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Flex, Pagination, Spin, Table, Typography } from 'antd';
import type { TableProps } from 'antd';
import { PAGE_SIZES, type JourneyVersionSummary } from '@journeylens/shared';
import { Link, useLocation } from 'react-router';
import { useListPagination, useSyncListPage } from '@/hooks/use-list-pagination';
import { getApiErrorMessage, isSessionExpired } from '@/services/api';
import { getJourneyVersions } from '@/services/journeys';
import { formatDateTime } from '@/utils/format-date-time';
import { tableScrollX } from '@/utils/table-scroll';
import { journeyVersionQueryKeys } from '../journey-queries';

type Props = { journeyId: string };

export function JourneyVersionsSection({ journeyId }: Props) {
  const location = useLocation();
  const { pageParam, pageSizeParam, setPagination } = useListPagination();
  const queryInput = { page: pageParam, pageSize: pageSizeParam };
  const query = useQuery({
    queryKey: journeyVersionQueryKeys.list(journeyId, queryInput),
    queryFn: ({ signal }) => getJourneyVersions(journeyId, queryInput, signal),
    placeholderData: keepPreviousData,
  });
  useSyncListPage(query);

  const list = query.data;
  const loadError =
    list === undefined && query.error !== null && !isSessionExpired(query.error)
      ? getApiErrorMessage(query.error)
      : undefined;
  const refreshError =
    list !== undefined && query.error !== null && !isSessionExpired(query.error)
      ? '版本列表暂时无法刷新，当前内容可能不是最新的'
      : undefined;

  const columns: NonNullable<TableProps<JourneyVersionSummary>['columns']> = [
    {
      title: '版本',
      key: 'versionNumber',
      width: 120,
      render: (_value, version) => `第 ${version.versionNumber} 版`,
    },
    {
      title: '发布时间',
      dataIndex: 'publishedAt',
      key: 'publishedAt',
      width: 200,
      render: formatDateTime,
    },
    {
      title: '发布人',
      key: 'publishedBy',
      width: 180,
      render: (_value, version) => version.publishedBy.displayName,
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_value, version) => (
        <Link
          to={`/journeys/${journeyId}/versions/${version.id}`}
          state={{ versionListSearch: location.search, journeyDetailState: location.state }}
        >
          查看版本
        </Link>
      ),
    },
  ];

  return (
    <Card title="已发布版本" styles={{ body: { padding: 16 } }}>
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
        {list === undefined ? (
          query.isPending && (
            <Flex justify="center" role="status" aria-label="正在读取版本" style={{ padding: 24 }}>
              <Spin />
            </Flex>
          )
        ) : list.data.length === 0 ? (
          <Empty description="尚未发布版本" />
        ) : (
          <>
            <Table<JourneyVersionSummary>
              size="small"
              scroll={{ x: tableScrollX(columns) }}
              rowKey="id"
              columns={columns}
              dataSource={list.data}
              pagination={false}
              loading={query.isFetching}
            />
            <Flex justify="end" align="center" gap={12} wrap>
              <Typography.Text type="secondary">共 {list.page.total} 个版本</Typography.Text>
              <Pagination
                current={list.page.page}
                pageSize={list.page.pageSize}
                total={list.page.total}
                pageSizeOptions={[...PAGE_SIZES]}
                showSizeChanger={{ id: 'journey-version-page-size', 'aria-label': '每页条数' }}
                showQuickJumper
                disabled={query.isFetching}
                onChange={setPagination}
              />
            </Flex>
          </>
        )}
      </Flex>
    </Card>
  );
}
