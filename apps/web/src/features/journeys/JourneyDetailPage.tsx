import { Alert, Button, Card, Descriptions, Flex, Spin, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { ApiError, getApiErrorMessage, isSessionExpired } from '@/services/api';
import { campaignStatusLabels } from '@/features/campaigns/campaign-status';
import { getJourney } from '@/services/journeys';
import { SegmentRuleView } from '@/features/segments/components/SegmentRuleView';
import { formatDateTime } from '@/utils/format-date-time';
import { readReturnTo } from '@/utils/return-to';
import { journeyQueryKeys } from './journey-queries';

export function JourneyDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: journeyQueryKeys.detail(id),
    queryFn: ({ signal }) => getJourney(id, signal),
  });
  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const journey = notFound ? undefined : query.data;
  const loadError =
    journey === undefined && query.error !== null && !notFound && !isSessionExpired(query.error)
      ? getApiErrorMessage(query.error)
      : undefined;
  const refreshError =
    journey !== undefined && query.error !== null && !notFound && !isSessionExpired(query.error)
      ? getApiErrorMessage(query.error)
      : undefined;

  function goBack(): void {
    if (journey === undefined) {
      navigate('/campaigns');
      return;
    }
    // 列表链接会带上来源页和查询条件；直接打开时按真实活动归属返回。
    const returnTo = readReturnTo(location.state);
    if (returnTo !== undefined) {
      navigate(returnTo.path, { state: returnTo.state });
      return;
    }
    navigate(`/campaigns/${journey.campaign.id}`);
  }

  return (
    <section aria-label="旅程详情" style={{ maxWidth: 1080, margin: '0 auto' }}>
      <Flex vertical gap={16}>
        <PageHeader
          back={
            <Button type="link" style={{ paddingInline: 0 }} onClick={goBack}>
              返回列表
            </Button>
          }
          title={journey?.name ?? '旅程详情'}
          actions={
            journey && (
              <Button
                type="primary"
                onClick={() =>
                  navigate(`/journeys/${journey.id}/editor`, { state: location.state })
                }
              >
                {journey.campaign.status === 'draft' ? '编排旅程' : '查看编排'}
              </Button>
            )
          }
        />
        {journey !== undefined && refreshError && (
          <Alert
            type="warning"
            showIcon
            title="旅程暂时无法刷新，当前内容可能不是最新的"
            description={refreshError}
            action={<Button onClick={() => void query.refetch()}>重试</Button>}
          />
        )}
        {journey === undefined && query.isPending && (
          <Flex
            justify="center"
            role="status"
            aria-label="正在读取旅程"
            style={{ padding: '48px 0' }}
          >
            <Spin />
          </Flex>
        )}
        {notFound && <Alert type="warning" showIcon title="旅程不存在" />}
        {loadError && (
          <Alert
            type="error"
            showIcon
            title={loadError}
            action={<Button onClick={() => void query.refetch()}>重试</Button>}
          />
        )}
        {journey !== undefined && (
          <>
            <Card>
              <Descriptions bordered column={1}>
                <Descriptions.Item label="旅程名称">{journey.name}</Descriptions.Item>
                <Descriptions.Item label="说明">
                  {journey.description ?? '未填写'}
                </Descriptions.Item>
                <Descriptions.Item label="所属活动">
                  <Link to={`/campaigns/${journey.campaign.id}`}>{journey.campaign.name}</Link>
                  <Typography.Text type="secondary">
                    （{campaignStatusLabels[journey.campaign.status]}）
                  </Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="入口分群">
                  {journey.segment ? (
                    <Link to={`/segments/${journey.segment.id}`}>{journey.segment.name}</Link>
                  ) : (
                    <Typography.Text type="secondary">不限人群</Typography.Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="创建者">
                  {journey.createdBy.displayName}
                </Descriptions.Item>
                <Descriptions.Item label="创建时间">
                  {formatDateTime(journey.createdAt)}
                </Descriptions.Item>
                <Descriptions.Item label="更新时间">
                  {formatDateTime(journey.updatedAt)}
                </Descriptions.Item>
              </Descriptions>
            </Card>
            {journey.segment && (
              <Card title="入口分群规则">
                <SegmentRuleView rules={journey.segment.rules} />
              </Card>
            )}
          </>
        )}
      </Flex>
    </section>
  );
}
