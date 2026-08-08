import { useEffect } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SearchOutlined } from '@ant-design/icons';
import { Alert, Button, Col, Empty, Flex, Form, Input, Pagination, Table, Typography } from 'antd';
import type { TableProps } from 'antd';
import {
  PAGE_SIZES,
  type JourneyStatsItem,
  type JourneyStatsListQueryInput,
} from '@journeylens/shared';
import { Link, useLocation, useSearchParams } from 'react-router';
import { ListFilterBar, listFilterColProps } from '@/components/ListFilterBar';
import { ListPageLayout } from '@/components/ListPageLayout';
import { PagedSelect } from '@/components/PagedSelect';
import { PageHeader } from '@/components/PageHeader';
import { useListPagination, useSyncListPage } from '@/hooks/use-list-pagination';
import { getApiErrorMessage, isSessionExpired } from '@/services/api';
import { getCampaign, getCampaigns } from '@/services/campaigns';
import { getJourneyStatsList } from '@/services/journeys';
import { formatDateTime } from '@/utils/format-date-time';
import { tableScrollX } from '@/utils/table-scroll';
import { journeyStatsQueryKeys } from './journey-queries';

type FilterValues = { q?: string; campaignId?: string };

const filterKeys = ['q', 'campaignId'] as const;

function setOrDelete(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value === undefined || value === '') params.delete(key);
  else params.set(key, value);
}

export function JourneyStatsPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm<FilterValues>();
  const keyword = searchParams.get('q') ?? '';
  const campaignId = searchParams.get('campaignId') ?? undefined;
  const { pageParam, pageSizeParam, setPagination } = useListPagination();

  const queryInput: JourneyStatsListQueryInput = {
    ...(keyword ? { q: keyword } : {}),
    ...(campaignId === undefined ? {} : { campaignId }),
    page: pageParam,
    pageSize: pageSizeParam,
  };
  const listQuery = useQuery({
    queryKey: journeyStatsQueryKeys.list(queryInput),
    queryFn: ({ signal }) => getJourneyStatsList(queryInput, signal),
    placeholderData: keepPreviousData,
  });
  const list = listQuery.data;
  useSyncListPage(listQuery);

  const selectedCampaignQuery = useQuery({
    queryKey: [...journeyStatsQueryKeys.lists, 'campaign', campaignId],
    queryFn: ({ signal }) => getCampaign(campaignId!, signal),
    enabled: campaignId !== undefined,
  });

  useEffect(() => {
    form.resetFields();
    form.setFieldsValue({
      q: keyword,
      ...(campaignId === undefined ? {} : { campaignId }),
    });
  }, [campaignId, form, keyword]);

  const loadError =
    list === undefined && listQuery.error !== null && !isSessionExpired(listQuery.error)
      ? getApiErrorMessage(listQuery.error)
      : undefined;
  const refreshError =
    list !== undefined && listQuery.error !== null && !isSessionExpired(listQuery.error)
      ? '旅程统计暂时无法刷新，当前内容可能不是最新的'
      : undefined;
  const hasFilters = filterKeys.some((key) => searchParams.has(key));

  function applyFilters(values: FilterValues): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        setOrDelete(next, 'q', values.q?.trim());
        setOrDelete(next, 'campaignId', values.campaignId);
        next.delete('page');
        return next;
      },
      { state: location.state },
    );
  }

  function resetFilters(): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const key of filterKeys) next.delete(key);
        next.delete('page');
        return next;
      },
      { state: location.state },
    );
  }

  const columns: NonNullable<TableProps<JourneyStatsItem>['columns']> = [
    {
      title: '旅程名称',
      dataIndex: 'name',
      key: 'name',
      width: 280,
      render: (name: string) => <Typography.Text strong>{name}</Typography.Text>,
    },
    {
      title: '所属活动',
      key: 'campaign',
      width: 240,
      render: (_value, item) => (
        <Link to={`/campaigns/${item.campaign.id}`} style={{ fontWeight: 600 }}>
          {item.campaign.name}
        </Link>
      ),
    },
    {
      title: '最新发布版本',
      key: 'latestVersion',
      width: 220,
      render: (_value, item) => (
        <Flex vertical gap={2}>
          <Typography.Text>第 {item.latestVersion.versionNumber} 版</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            发布于 {formatDateTime(item.latestVersion.publishedAt)}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_value, item) => (
        <Link
          to={`/journeys/${item.id}/versions/${item.latestVersion.id}`}
          // 带上当前搜索串，返回时恢复原查询条件与页码。
          state={{ fromJourneyStats: { search: location.search } }}
          style={{ fontWeight: 600 }}
        >
          查看统计
        </Link>
      ),
    },
  ];

  return (
    <section aria-label="旅程统计">
      <Flex vertical gap={16} style={{ maxWidth: 1560, margin: '0 auto' }}>
        <PageHeader title="旅程统计" />
        <ListPageLayout
          loading={list === undefined && listQuery.isPending}
          loadingLabel="正在读取旅程统计"
          filters={
            <ListFilterBar form={form} onSearch={applyFilters} onReset={resetFilters}>
              <Col {...listFilterColProps}>
                <Form.Item name="q" label="关键词">
                  <Input
                    allowClear
                    maxLength={100}
                    placeholder="搜索旅程名称"
                    prefix={<SearchOutlined aria-hidden />}
                  />
                </Form.Item>
              </Col>
              <Col {...listFilterColProps}>
                <Form.Item name="campaignId" label="所属活动">
                  <PagedSelect
                    resourceKey="journey-stats-campaigns"
                    placeholder="全部活动"
                    loadPage={({ q, page: optionPage, pageSize: optionPageSize }) =>
                      getCampaigns({
                        ...(q ? { q } : {}),
                        page: optionPage,
                        pageSize: optionPageSize,
                      })
                    }
                    selectedOption={
                      selectedCampaignQuery.data === undefined
                        ? undefined
                        : {
                            id: selectedCampaignQuery.data.id,
                            name: selectedCampaignQuery.data.name,
                          }
                    }
                  />
                </Form.Item>
              </Col>
            </ListFilterBar>
          }
          footer={
            list === undefined ? undefined : (
              <Pagination
                current={list.page.page}
                pageSize={list.page.pageSize}
                total={list.page.total}
                pageSizeOptions={[...PAGE_SIZES]}
                showSizeChanger={{ id: 'journey-stats-page-size', 'aria-label': '每页条数' }}
                showQuickJumper
                disabled={listQuery.isFetching}
                showTotal={(total) => `共 ${total} 个旅程`}
                onChange={setPagination}
              />
            )
          }
        >
          <Flex vertical gap={16}>
            {refreshError !== undefined && (
              <Alert
                type="warning"
                showIcon
                title={refreshError}
                action={<Button onClick={() => void listQuery.refetch()}>重试</Button>}
              />
            )}
            {loadError !== undefined && (
              <Alert
                type="error"
                showIcon
                title={loadError}
                action={<Button onClick={() => void listQuery.refetch()}>重试</Button>}
              />
            )}
            {list !== undefined && (
              <Table<JourneyStatsItem>
                rowKey="id"
                columns={columns}
                dataSource={list.data}
                pagination={false}
                scroll={{ x: tableScrollX(columns) }}
                loading={listQuery.isFetching}
                locale={{
                  emptyText: loadError ? null : (
                    <Empty
                      description={hasFilters ? '没有符合条件的旅程' : '暂无已发布版本的旅程'}
                    />
                  ),
                }}
              />
            )}
          </Flex>
        </ListPageLayout>
      </Flex>
    </section>
  );
}
