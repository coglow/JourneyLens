import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Col,
  DatePicker,
  Empty,
  Flex,
  Form,
  Input,
  Pagination,
  Select,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  EXECUTION_SEARCH_MAX_LENGTH,
  EXECUTION_STATUSES,
  PAGE_SIZES,
  type ExecutionListItem,
  type ExecutionListQueryInput,
  type ExecutionStatus,
} from '@journeylens/shared';
import { Link, useLocation, useSearchParams } from 'react-router';
import { ListFilterBar, listFilterColProps } from '@/components/ListFilterBar';
import { ListPageLayout } from '@/components/ListPageLayout';
import { PagedSelect } from '@/components/PagedSelect';
import { PageHeader } from '@/components/PageHeader';
import { useListPagination, useSyncListPage } from '@/hooks/use-list-pagination';
import { getApiErrorMessage, isSessionExpired } from '@/services/api';
import { getCampaign, getCampaigns } from '@/services/campaigns';
import { getExecutions } from '@/services/executions';
import { getJourney, getJourneys } from '@/services/journeys';
import { formatDateTime } from '@/utils/format-date-time';
import { executionQueryKeys } from './execution-queries';
import { executionStatusBadges, executionStatusLabels } from './execution-status';

type DateTimeRange = [Dayjs | null, Dayjs | null] | null;

type FilterValues = {
  campaignId?: string;
  journeyId?: string;
  status?: ExecutionStatus | 'all';
  q?: string;
  createdRange?: DateTimeRange;
  endedRange?: DateTimeRange;
};

const statusOptions = [
  { label: '全部', value: 'all' },
  ...EXECUTION_STATUSES.map((status) => ({ label: executionStatusLabels[status], value: status })),
];

const filterKeys = [
  'campaignId',
  'journeyId',
  'status',
  'q',
  'createdFrom',
  'createdTo',
  'endedFrom',
  'endedTo',
] as const;

function setOrDelete(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value) params.set(key, value);
  else params.delete(key);
}

function readDayjs(value: string | null | undefined): Dayjs | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

function getExecutionColumns(
  returnTo: string,
): NonNullable<TableProps<ExecutionListItem>['columns']> {
  return [
    {
      title: '用户',
      key: 'audience',
      width: 190,
      render: (_value, execution) => (
        <Flex vertical>
          <Typography.Text strong>{execution.audience.displayName}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {execution.audience.externalId}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: '活动',
      key: 'campaign',
      width: 170,
      render: (_value, execution) => (
        <Link to={`/campaigns/${execution.campaign.id}`}>{execution.campaign.name}</Link>
      ),
    },
    {
      title: '旅程及版本',
      key: 'journey',
      width: 230,
      render: (_value, execution) => (
        <Flex vertical gap={4}>
          <Link to={`/journeys/${execution.journey.id}`}>{execution.journey.name}</Link>
          <Tag style={{ width: 'fit-content', marginInlineEnd: 0 }}>
            第 {execution.version.versionNumber} 版
          </Tag>
        </Flex>
      ),
    },
    {
      title: '当前步骤或结束结果',
      key: 'progress',
      width: 240,
      render: (_value, execution) =>
        execution.status === 'running' || execution.status === 'waiting'
          ? (execution.currentStep?.name ?? '—')
          : (execution.result ?? '—'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: ExecutionListItem['status']) => (
        <Badge status={executionStatusBadges[status]} text={executionStatusLabels[status]} />
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 190,
      render: formatDateTime,
    },
    {
      title: '操作',
      key: 'actions',
      width: 130,
      fixed: 'end',
      render: (_value, execution) => (
        <Link to={`/executions/${execution.id}`} state={{ returnTo }} style={{ fontWeight: 600 }}>
          查看执行轨迹
        </Link>
      ),
    },
  ];
}

export function ExecutionsPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm<FilterValues>();
  const { pageParam, pageSizeParam, setPagination } = useListPagination();

  const campaignId = searchParams.get('campaignId') ?? undefined;
  const journeyId = searchParams.get('journeyId') ?? undefined;
  const rawSearch = searchParams.get('q') ?? undefined;
  const rawStatus = searchParams.get('status');
  const rawCreatedFrom = searchParams.get('createdFrom') ?? undefined;
  const rawCreatedTo = searchParams.get('createdTo') ?? undefined;
  const rawEndedFrom = searchParams.get('endedFrom') ?? undefined;
  const rawEndedTo = searchParams.get('endedTo') ?? undefined;
  const watchedCampaignId = Form.useWatch('campaignId', form);

  const queryInput: ExecutionListQueryInput = {
    ...(campaignId ? { campaignId } : {}),
    ...(journeyId ? { journeyId } : {}),
    // 原始值交给契约校验：非法状态明确报错，不静默改成“全部”。
    ...(rawStatus !== null ? { status: rawStatus as ExecutionStatus } : {}),
    ...(rawSearch ? { q: rawSearch } : {}),
    ...(rawCreatedFrom ? { createdFrom: rawCreatedFrom } : {}),
    ...(rawCreatedTo ? { createdTo: rawCreatedTo } : {}),
    ...(rawEndedFrom ? { endedFrom: rawEndedFrom } : {}),
    ...(rawEndedTo ? { endedTo: rawEndedTo } : {}),
    page: pageParam,
    pageSize: pageSizeParam,
  };

  const listQuery = useQuery({
    queryKey: executionQueryKeys.list(queryInput),
    queryFn: ({ signal }) => getExecutions(queryInput, signal),
  });
  const list = listQuery.data;
  useSyncListPage(listQuery);

  const selectedCampaignQuery = useQuery({
    queryKey: ['execution-filter', 'campaign', campaignId],
    queryFn: ({ signal }) => getCampaign(campaignId!, signal),
    enabled: campaignId !== undefined,
  });
  const selectedJourneyQuery = useQuery({
    queryKey: ['execution-filter', 'journey', journeyId],
    queryFn: ({ signal }) => getJourney(journeyId!, signal),
    enabled: journeyId !== undefined,
  });

  useEffect(() => {
    const status =
      rawStatus !== null && (EXECUTION_STATUSES as readonly string[]).includes(rawStatus)
        ? (rawStatus as ExecutionStatus)
        : 'all';
    const createdFrom = readDayjs(rawCreatedFrom);
    const createdTo = readDayjs(rawCreatedTo);
    const endedFrom = readDayjs(rawEndedFrom);
    const endedTo = readDayjs(rawEndedTo);
    const createdRange: DateTimeRange =
      createdFrom === null && createdTo === null ? null : [createdFrom, createdTo];
    const endedRange: DateTimeRange =
      endedFrom === null && endedTo === null ? null : [endedFrom, endedTo];

    // 先清空上一轮恢复的值，再只写入网址里确实存在的条件。
    form.resetFields();
    form.setFieldsValue({
      status,
      q: rawSearch ?? '',
      ...(campaignId === undefined ? {} : { campaignId }),
      ...(journeyId === undefined ? {} : { journeyId }),
      ...(createdRange === null ? {} : { createdRange }),
      ...(endedRange === null ? {} : { endedRange }),
    });
  }, [
    campaignId,
    form,
    journeyId,
    rawCreatedFrom,
    rawCreatedTo,
    rawEndedFrom,
    rawEndedTo,
    rawSearch,
    rawStatus,
  ]);

  const loadError =
    list === undefined && listQuery.error !== null && !isSessionExpired(listQuery.error)
      ? getApiErrorMessage(listQuery.error)
      : undefined;
  const refreshError =
    list !== undefined && listQuery.error !== null && !isSessionExpired(listQuery.error)
      ? '执行记录暂时无法刷新，当前内容可能不是最新的'
      : undefined;

  function applyFilters(values: FilterValues): void {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      setOrDelete(next, 'campaignId', values.campaignId);
      setOrDelete(next, 'journeyId', values.journeyId);
      setOrDelete(next, 'status', values.status === 'all' ? undefined : values.status);
      setOrDelete(next, 'q', values.q?.trim());
      setOrDelete(next, 'createdFrom', values.createdRange?.[0]?.toISOString());
      setOrDelete(next, 'createdTo', values.createdRange?.[1]?.toISOString());
      setOrDelete(next, 'endedFrom', values.endedRange?.[0]?.toISOString());
      setOrDelete(next, 'endedTo', values.endedRange?.[1]?.toISOString());
      // 筛选条件变化后回到第一页。
      next.delete('page');
      return next;
    });
  }

  function resetFilters(): void {
    form.resetFields();
    form.setFieldsValue({ status: 'all', q: '' });
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const key of filterKeys) next.delete(key);
      next.delete('page');
      return next;
    });
  }

  const hasFilters = filterKeys.some((key) => searchParams.has(key));
  const columns = getExecutionColumns(location.search);

  return (
    <section aria-label="执行记录">
      <Flex vertical gap={16} style={{ maxWidth: 1560, margin: '0 auto' }}>
        <PageHeader title="执行记录" />

        <ListPageLayout
          loading={list === undefined && listQuery.isPending}
          loadingLabel="正在读取执行记录"
          toolbar={
            <Button
              icon={<ReloadOutlined aria-hidden />}
              loading={listQuery.isFetching}
              onClick={() => void listQuery.refetch()}
            >
              刷新
            </Button>
          }
          filters={
            <ListFilterBar form={form} onSearch={applyFilters} onReset={resetFilters}>
              <Col {...listFilterColProps}>
                <Form.Item name="campaignId" label="活动">
                  <PagedSelect
                    resourceKey="campaigns"
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
                    onChange={() => form.setFieldValue('journeyId', undefined)}
                  />
                </Form.Item>
              </Col>
              <Col {...listFilterColProps}>
                <Form.Item name="journeyId" label="旅程">
                  <PagedSelect
                    resourceKey={`journeys:${watchedCampaignId ?? 'none'}`}
                    placeholder={watchedCampaignId === undefined ? '请先选择活动' : '全部旅程'}
                    disabled={watchedCampaignId === undefined}
                    loadPage={(input) =>
                      watchedCampaignId === undefined
                        ? Promise.resolve({
                            data: [],
                            page: { page: 1, pageSize: input.pageSize, total: 0 },
                          })
                        : getJourneys(watchedCampaignId, input)
                    }
                    selectedOption={
                      selectedJourneyQuery.data === undefined
                        ? undefined
                        : { id: selectedJourneyQuery.data.id, name: selectedJourneyQuery.data.name }
                    }
                  />
                </Form.Item>
              </Col>
              <Col {...listFilterColProps}>
                <Form.Item name="status" label="状态">
                  <Select allowClear options={statusOptions} />
                </Form.Item>
              </Col>
              <Col {...listFilterColProps}>
                <Form.Item name="q" label="关键词">
                  <Input
                    allowClear
                    maxLength={EXECUTION_SEARCH_MAX_LENGTH}
                    placeholder="搜索用户昵称或外部 ID"
                    prefix={<SearchOutlined aria-hidden />}
                  />
                </Form.Item>
              </Col>
              <Col {...listFilterColProps}>
                <Form.Item name="createdRange" label="创建时间">
                  <DatePicker.RangePicker
                    showTime={{ format: 'HH:mm' }}
                    format="YYYY-MM-DD HH:mm"
                    allowClear
                    placeholder={['开始时间', '结束时间']}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col {...listFilterColProps}>
                <Form.Item name="endedRange" label="结束时间">
                  <DatePicker.RangePicker
                    showTime={{ format: 'HH:mm' }}
                    format="YYYY-MM-DD HH:mm"
                    allowClear
                    placeholder={['开始时间', '结束时间']}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
            </ListFilterBar>
          }
          footer={
            list !== undefined && (
              <Pagination
                current={list.page.page}
                pageSize={list.page.pageSize}
                total={list.page.total}
                showSizeChanger={{ id: 'execution-page-size', 'aria-label': '每页条数' }}
                pageSizeOptions={[...PAGE_SIZES]}
                showQuickJumper
                disabled={listQuery.isFetching}
                showTotal={(total) => `共 ${total} 条`}
                onChange={setPagination}
              />
            )
          }
        >
          {refreshError !== undefined && (
            <Alert
              style={{ marginBottom: 16 }}
              type="warning"
              showIcon
              title={refreshError}
              action={<Button onClick={() => void listQuery.refetch()}>重试</Button>}
            />
          )}
          {loadError !== undefined && (
            <Alert
              style={{ marginBottom: 16 }}
              type="error"
              showIcon
              title={loadError}
              action={<Button onClick={() => void listQuery.refetch()}>重试</Button>}
            />
          )}

          {list !== undefined && (
            <Table<ExecutionListItem>
              rowKey="id"
              columns={columns}
              dataSource={list.data}
              pagination={false}
              scroll={{ x: 1250 }}
              tableLayout="fixed"
              size="middle"
              loading={listQuery.isFetching}
              locale={{
                emptyText: loadError ? null : (
                  <Empty description={hasFilters ? '没有符合条件的执行记录' : '暂无执行记录'} />
                ),
              }}
            />
          )}
        </ListPageLayout>
      </Flex>
    </section>
  );
}
