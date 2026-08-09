import { Alert, Button, Descriptions, Flex, Spin, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { ApiError, getApiErrorMessage, isSessionExpired } from '@/services/api';
import { canEditCampaign } from '@journeylens/shared';
import { campaignStatusBadges, campaignStatusLabels } from '@/features/campaigns/campaign-status';
import { getJourney } from '@/services/journeys';
import { JourneyVersionsSection } from '@/features/journeys/components/JourneyVersionsSection';
import { formatDateTime } from '@/utils/format-date-time';
import { readReturnTo } from '@/utils/return-to';
import { journeyQueryKeys } from './journey-queries';
import styles from './JourneyDetailPage.module.css';

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
    <section aria-label="旅程详情" className={styles.page}>
      <header className={styles.overview}>
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
                {canEditCampaign(journey.campaign.status) ? '编排旅程' : '查看编排'}
              </Button>
            )
          }
        />
        {journey !== undefined && (
          <div className={styles.details}>
            <div className={styles.businessDetails}>
              <div className={styles.metadata}>
                <section className={styles.metadataItem} aria-label="所属活动">
                  <Typography.Text type="secondary">所属活动</Typography.Text>
                  <div className={styles.metadataValue}>
                    <Link to={`/campaigns/${journey.campaign.id}`}>{journey.campaign.name}</Link>
                    <Tag color={campaignStatusBadges[journey.campaign.status]}>
                      {campaignStatusLabels[journey.campaign.status]}
                    </Tag>
                  </div>
                </section>
                <section className={styles.metadataItem} aria-label="入口人群">
                  <Typography.Text type="secondary">入口人群</Typography.Text>
                  <div className={styles.metadataValue}>
                    {journey.segment ? (
                      <Link
                        to={`/segments/${journey.segment.id}`}
                        state={{ returnTo: `/journeys/${journey.id}`, returnState: location.state }}
                      >
                        {journey.segment.name}
                      </Link>
                    ) : (
                      <Typography.Text>不限人群</Typography.Text>
                    )}
                  </div>
                </section>
              </div>
              <section className={styles.description} aria-label="旅程说明">
                <Typography.Text type="secondary">旅程说明</Typography.Text>
                <Typography.Text>{journey.description ?? '未填写'}</Typography.Text>
              </section>
            </div>
            <aside className={styles.creationInfo} aria-label="创建信息">
              <Typography.Text type="secondary">创建信息</Typography.Text>
              <Descriptions column={1} size="small" colon={false}>
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
            </aside>
          </div>
        )}
      </header>
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
      {journey !== undefined && <JourneyVersionsSection journeyId={journey.id} />}
    </section>
  );
}
