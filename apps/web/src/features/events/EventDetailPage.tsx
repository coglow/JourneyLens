import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Flex, Spin, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  JOURNEY_EVENT_TYPE_LABELS,
  journeyEventFields,
  type EventDetail,
} from '@journeylens/shared';
import { useLocation, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { ApiError, getApiErrorMessage, isSessionExpired } from '@/services/api';
import { getEvent } from '@/services/events';
import { formatDateTime } from '@/utils/format-date-time';
import { formatFieldValue } from '@/utils/format-field-value';
import { EventExecutionsSection } from './components/EventExecutionsSection';
import { eventQueryKeys } from './event-queries';

function readReturnTo(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('returnTo' in state)) return '';
  const returnTo = state.returnTo;
  return typeof returnTo === 'string' && (returnTo === '' || returnTo.startsWith('?'))
    ? returnTo
    : '';
}

function eventDescriptions(event: EventDetail) {
  const fields = journeyEventFields(event.type);
  const content = fields.flatMap((field) =>
    Object.hasOwn(event.payload, field.key)
      ? [
          {
            key: field.key,
            label: field.label,
            children: formatFieldValue(event.payload[field.key], field),
          },
        ]
      : [],
  );

  return [
    { key: 'user', label: '用户', children: event.audience.displayName },
    { key: 'externalId', label: '用户ID', children: event.audience.externalId },
    { key: 'receivedAt', label: '接收时间', children: formatDateTime(event.receivedAt) },
    ...content,
  ];
}

export function EventDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [relatedEventMissing, setRelatedEventMissing] = useState(false);
  const markRelatedEventMissing = useCallback(() => setRelatedEventMissing(true), []);
  const query = useQuery({
    queryKey: eventQueryKeys.detail(id),
    queryFn: ({ signal }) => getEvent(id, signal),
  });
  const event = query.data;

  useEffect(() => setRelatedEventMissing(false), [id]);

  const notFound =
    relatedEventMissing || (query.error instanceof ApiError && query.error.status === 404);
  const loadError =
    event === undefined && query.error !== null && !notFound && !isSessionExpired(query.error)
      ? getApiErrorMessage(query.error)
      : undefined;
  const refreshError =
    event !== undefined && query.error !== null && !notFound && !isSessionExpired(query.error)
      ? '行为记录暂时无法刷新，当前内容可能不是最新的'
      : undefined;
  const returnTo = readReturnTo(location.state);

  async function refresh(): Promise<void> {
    await Promise.all([
      query.refetch(),
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.relatedJourneys(id) }),
    ]);
  }

  return (
    <section aria-label="行为详情">
      <Flex vertical gap={16} style={{ maxWidth: 1560, margin: '0 auto' }}>
        <PageHeader
          back={
            <Button type="link" onClick={() => navigate(`/events${returnTo}`)}>
              返回行为记录
            </Button>
          }
          title={event === undefined ? '行为详情' : JOURNEY_EVENT_TYPE_LABELS[event.type]}
          actions={
            <Button
              icon={<ReloadOutlined aria-hidden />}
              loading={query.isFetching}
              onClick={() => void refresh()}
            >
              刷新
            </Button>
          }
        />
        {refreshError !== undefined && (
          <Alert
            type="warning"
            showIcon
            title={refreshError}
            action={<Button onClick={() => void refresh()}>重试</Button>}
          />
        )}
        {notFound && <Alert type="warning" showIcon title="行为记录不存在" />}
        {loadError !== undefined && (
          <Alert
            type="error"
            showIcon
            title={loadError}
            action={<Button onClick={() => void query.refetch()}>重试</Button>}
          />
        )}
        {event === undefined && query.isPending && !notFound && (
          <Flex
            justify="center"
            role="status"
            aria-label="正在读取行为详情"
            style={{ padding: 48 }}
          >
            <Spin />
          </Flex>
        )}
        {event !== undefined && !notFound && (
          <>
            <Card
              title="行为资料"
              extra={
                <Typography.Text
                  copyable={{ text: event.id }}
                  ellipsis
                  style={{ maxWidth: 'min(420px, 42vw)' }}
                >
                  行为ID：{event.id}
                </Typography.Text>
              }
            >
              <Flex vertical gap={12}>
                {journeyEventFields(event.type).length === 0 && (
                  <Typography.Text type="secondary">该行为没有附加内容</Typography.Text>
                )}
                <Descriptions
                  bordered
                  column={{ xs: 1, sm: 2, md: 3 }}
                  items={eventDescriptions(event)}
                />
              </Flex>
            </Card>
            <EventExecutionsSection eventId={event.id} onEventNotFound={markRelatedEventMissing} />
          </>
        )}
      </Flex>
    </section>
  );
}
