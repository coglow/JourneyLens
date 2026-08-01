import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
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
  Typography,
  type TableProps,
} from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  EVENT_SEARCH_MAX_LENGTH,
  JOURNEY_EVENT_TYPES,
  JOURNEY_EVENT_TYPE_LABELS,
  PAGE_SIZES,
  type EventListItem,
  type EventListQueryInput,
  type JourneyEventType,
} from '@journeylens/shared';
import { Link, useLocation, useSearchParams } from 'react-router';
import { ListFilterBar, listFilterColProps } from '@/components/ListFilterBar';
import { ListPageLayout } from '@/components/ListPageLayout';
import { PageHeader } from '@/components/PageHeader';
import { useListPagination, useSyncListPage } from '@/hooks/use-list-pagination';
import { getApiErrorMessage, isSessionExpired } from '@/services/api';
import { getEvents } from '@/services/events';
import { formatDateTime } from '@/utils/format-date-time';
import { eventQueryKeys } from './event-queries';

type DateTimeRange = [Dayjs | null, Dayjs | null] | null;

type FilterValues = {
  q?: string;
  type?: JourneyEventType | 'all';
  eventId?: string;
  receivedRange?: DateTimeRange;
};

const filterKeys = ['q', 'type', 'eventId', 'receivedFrom', 'receivedTo'] as const;
const typeOptions = [
  { label: '全部', value: 'all' },
  ...JOURNEY_EVENT_TYPES.map((type) => ({ label: JOURNEY_EVENT_TYPE_LABELS[type], value: type })),
];

function setOrDelete(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value) params.set(key, value);
  else params.delete(key);
}

function readDayjs(value: string | undefined): Dayjs | null {
  if (value === undefined) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

function eventColumns(returnTo: string): NonNullable<TableProps<EventListItem>['columns']> {
  return [
    {
      title: '用户',
      key: 'audience',
      width: 190,
      render: (_value, event) => (
        <Flex vertical>
          <Typography.Text strong>{event.audience.displayName}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            用户ID：{event.audience.externalId}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: '行为类型',
      dataIndex: 'type',
      key: 'type',
      width: 140,
      render: (type: JourneyEventType) => JOURNEY_EVENT_TYPE_LABELS[type],
    },
    {
      title: '接收时间',
      dataIndex: 'receivedAt',
      key: 'receivedAt',
      width: 190,
      render: formatDateTime,
    },
    {
      title: '行为ID',
      key: 'id',
      width: 230,
      render: (_value, event) => (
        <Typography.Text copyable={{ text: event.id }} ellipsis style={{ maxWidth: 205 }}>
          {event.id}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      fixed: 'end',
      render: (_value, event) => (
        <Link to={`/events/${event.id}`} state={{ returnTo }} style={{ fontWeight: 600 }}>
          查看详情
        </Link>
      ),
    },
  ];
}

export function EventsPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm<FilterValues>();
  const { pageParam, pageSizeParam, setPagination } = useListPagination();

  const rawSearch = searchParams.get('q') ?? undefined;
  const rawType = searchParams.get('type') ?? undefined;
  const rawEventId = searchParams.get('eventId') ?? undefined;
  const rawReceivedFrom = searchParams.get('receivedFrom') ?? undefined;
  const rawReceivedTo = searchParams.get('receivedTo') ?? undefined;

  const queryInput: EventListQueryInput = {
    ...(rawSearch === undefined ? {} : { q: rawSearch }),
    ...(rawType === undefined ? {} : { type: rawType as JourneyEventType }),
    ...(rawEventId === undefined ? {} : { eventId: rawEventId }),
    ...(rawReceivedFrom === undefined ? {} : { receivedFrom: rawReceivedFrom }),
    ...(rawReceivedTo === undefined ? {} : { receivedTo: rawReceivedTo }),
    ...(pageParam === undefined ? {} : { page: pageParam }),
    ...(pageSizeParam === undefined ? {} : { pageSize: pageSizeParam }),
  };

  const listQuery = useQuery({
    queryKey: eventQueryKeys.list(queryInput),
    queryFn: ({ signal }) => getEvents(queryInput, signal),
  });
  const list = listQuery.data;
  useSyncListPage(listQuery);

  useEffect(() => {
    const type = (JOURNEY_EVENT_TYPES as readonly string[]).includes(rawType ?? '')
      ? (rawType as JourneyEventType)
      : 'all';
    const from = readDayjs(rawReceivedFrom);
    const to = readDayjs(rawReceivedTo);
    const receivedRange: DateTimeRange = from === null && to === null ? null : [from, to];

    form.resetFields();
    form.setFieldsValue({
      q: rawSearch ?? '',
      type,
      eventId: rawEventId ?? '',
      ...(receivedRange === null ? {} : { receivedRange }),
    });
  }, [form, rawEventId, rawReceivedFrom, rawReceivedTo, rawSearch, rawType]);

  const loadError =
    list === undefined && listQuery.error !== null && !isSessionExpired(listQuery.error)
      ? getApiErrorMessage(listQuery.error)
      : undefined;
  const refreshError =
    list !== undefined && listQuery.error !== null && !isSessionExpired(listQuery.error)
      ? '行为记录暂时无法刷新，当前内容可能不是最新的'
      : undefined;

  function applyFilters(values: FilterValues): void {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      setOrDelete(next, 'q', values.q?.trim());
      setOrDelete(next, 'type', values.type === 'all' ? undefined : values.type);
      setOrDelete(next, 'eventId', values.eventId?.trim());
      setOrDelete(next, 'receivedFrom', values.receivedRange?.[0]?.toISOString());
      setOrDelete(next, 'receivedTo', values.receivedRange?.[1]?.toISOString());
      next.delete('page');
      return next;
    });
  }

  function resetFilters(): void {
    form.resetFields();
    form.setFieldsValue({ q: '', type: 'all', eventId: '' });
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const key of filterKeys) next.delete(key);
      next.delete('page');
      return next;
    });
  }

  const hasFilters = filterKeys.some((key) => searchParams.has(key));

  return (
    <section aria-label="行为记录">
      <Flex vertical gap={16} style={{ maxWidth: 1560, margin: '0 auto' }}>
        <PageHeader title="行为记录" />

        <ListPageLayout
          loading={list === undefined && listQuery.isPending}
          loadingLabel="正在读取行为记录"
          toolbar={
            <Flex justify="space-between" align="center" gap={16} wrap style={{ width: '100%' }}>
              <Typography.Text type="secondary">仅展示已成功接收并保存的行为。</Typography.Text>
              <Button
                icon={<ReloadOutlined aria-hidden />}
                loading={listQuery.isFetching}
                onClick={() => void listQuery.refetch()}
              >
                刷新
              </Button>
            </Flex>
          }
          filters={
            <ListFilterBar form={form} onSearch={applyFilters} onReset={resetFilters}>
              <Col {...listFilterColProps}>
                <Form.Item name="q" label="用户">
                  <Input
                    allowClear
                    maxLength={EVENT_SEARCH_MAX_LENGTH}
                    placeholder="搜索当前昵称或用户ID"
                    prefix={<SearchOutlined aria-hidden />}
                  />
                </Form.Item>
              </Col>
              <Col {...listFilterColProps}>
                <Form.Item name="type" label="行为类型">
                  <Select allowClear options={typeOptions} />
                </Form.Item>
              </Col>
              <Col {...listFilterColProps}>
                <Form.Item name="receivedRange" label="接收时间">
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
                <Form.Item name="eventId" label="行为ID">
                  <Input allowClear placeholder="输入完整ID精确查询" />
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
                showSizeChanger={{ id: 'event-page-size', 'aria-label': '每页条数' }}
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
            <Table<EventListItem>
              rowKey="id"
              columns={eventColumns(location.search)}
              dataSource={list.data}
              pagination={false}
              scroll={{ x: 880 }}
              tableLayout="fixed"
              size="middle"
              loading={listQuery.isFetching}
              locale={{
                emptyText: (
                  <Empty description={hasFilters ? '没有符合条件的行为' : '还没有已接收的行为'} />
                ),
              }}
            />
          )}
        </ListPageLayout>
      </Flex>
    </section>
  );
}
