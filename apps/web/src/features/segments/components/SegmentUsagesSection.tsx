import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Empty, Flex, Pagination, Table } from 'antd';
import type { TableProps } from 'antd';
import { PAGE_SIZES, type PaginationQueryInput, type SegmentUsageItem } from '@journeylens/shared';
import { Link, useLocation } from 'react-router';
import { useListPagination, useSyncListPage } from '@/hooks/use-list-pagination';
import { ApiError, getApiErrorMessage, isSessionExpired } from '@/services/api';
import { getSegmentUsages } from '@/services/segments';
import { campaignStatusBadges, campaignStatusLabels } from '@/features/campaigns/campaign-status';
import { segmentQueryKeys } from '../segment-queries';
import { formatDateTime } from '@/utils/format-date-time';

type Props = { segmentId: string };

export function SegmentUsagesSection({ segmentId }: Props) {
  const location = useLocation();
  const { pageParam, pageSizeParam, setPagination } = useListPagination();
  const queryInput: PaginationQueryInput = {
    page: pageParam,
    pageSize: pageSizeParam,
  };
  const usagesQuery = useQuery({
    queryKey: segmentQueryKeys.usages(segmentId, queryInput),
    queryFn: ({ signal }) => getSegmentUsages(segmentId, queryInput, signal),
    placeholderData: keepPreviousData,
  });
  const list = usagesQuery.data;
  useSyncListPage(usagesQuery);
  const notFound = usagesQuery.error instanceof ApiError && usagesQuery.error.status === 404;
  const loadError =
    list === undefined &&
    usagesQuery.error !== null &&
    !notFound &&
    !isSessionExpired(usagesQuery.error)
      ? getApiErrorMessage(usagesQuery.error)
      : undefined;

  const columns: NonNullable<TableProps<SegmentUsageItem>['columns']> = [
    {
      title: '旅程名称',
      dataIndex: ['journey', 'name'],
      key: 'journey',
      width: 220,
      render: (_value: string, usage: SegmentUsageItem) => (
        <Link
          to={`/journeys/${usage.journey.id}`}
          style={{ fontWeight: 600 }}
          state={{
            returnTo: `${location.pathname}${location.search}#usages`,
            returnState: location.state,
          }}
        >
          {usage.journey.name}
        </Link>
      ),
    },
    {
      title: '所属活动',
      dataIndex: ['campaign', 'name'],
      key: 'campaign',
      width: 220,
      render: (_value: string, usage: SegmentUsageItem) => (
        <Link to={`/campaigns/${usage.campaign.id}`} style={{ fontWeight: 600 }}>
          {usage.campaign.name}
        </Link>
      ),
    },
    {
      title: '活动状态',
      dataIndex: ['campaign', 'status'],
      key: 'campaignStatus',
      width: 140,
      render: (_value: string, usage: SegmentUsageItem) => (
        <Badge
          status={campaignStatusBadges[usage.campaign.status]}
          text={campaignStatusLabels[usage.campaign.status]}
        />
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 190,
      render: formatDateTime,
    },
  ];

  return (
    <Card id="usages" title="引用旅程">
      {list !== undefined &&
        usagesQuery.error !== null &&
        !notFound &&
        !isSessionExpired(usagesQuery.error) && (
          <Alert
            style={{ marginBottom: 16 }}
            type="warning"
            showIcon
            title="引用列表暂时无法刷新，当前内容可能不是最新的"
            description={getApiErrorMessage(usagesQuery.error)}
            action={<Button onClick={() => void usagesQuery.refetch()}>重试</Button>}
          />
        )}
      {list === undefined && usagesQuery.isPending && (
        <Flex
          justify="center"
          role="status"
          aria-label="正在读取引用旅程"
          style={{ padding: '32px 0' }}
        >
          正在读取引用旅程…
        </Flex>
      )}
      {notFound && <Alert type="warning" showIcon title="分群不存在" />}
      {loadError && (
        <Alert
          type="error"
          showIcon
          title={loadError}
          action={<Button onClick={() => void usagesQuery.refetch()}>重试</Button>}
        />
      )}
      {list !== undefined && !notFound && (
        <>
          <Table<SegmentUsageItem>
            rowKey={(usage) => usage.journey.id}
            columns={columns}
            dataSource={list.data}
            pagination={false}
            scroll={{ x: 770 }}
            tableLayout="fixed"
            loading={usagesQuery.isFetching}
            locale={{ emptyText: loadError ? null : <Empty description="暂无引用旅程" /> }}
          />
          <Flex justify="end" style={{ marginTop: 16 }}>
            <Pagination
              current={list.page.page}
              pageSize={list.page.pageSize}
              total={list.page.total}
              pageSizeOptions={[...PAGE_SIZES]}
              showSizeChanger={{ id: 'segment-usages-page-size', 'aria-label': '每页条数' }}
              showQuickJumper
              disabled={usagesQuery.isFetching}
              showTotal={(total) => `共 ${total} 条`}
              onChange={setPagination}
            />
          </Flex>
        </>
      )}
    </Card>
  );
}
