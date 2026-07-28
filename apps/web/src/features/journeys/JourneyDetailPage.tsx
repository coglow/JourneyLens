import { useState } from 'react';
import { Alert, Button, Flex, Spin, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { ApiError, getApiErrorMessage, isSessionExpired } from '@/services/api';
import { canEditCampaign } from '@journeylens/shared';
import { campaignStatusLabels } from '@/features/campaigns/campaign-status';
import { getJourney } from '@/services/journeys';
import { EntrySegmentRulesDrawer } from '@/features/journeys/components/EntrySegmentRulesDrawer';
import { JourneyVersionsSection } from '@/features/journeys/components/JourneyVersionsSection';
import { formatDateTime } from '@/utils/format-date-time';
import { readReturnTo } from '@/utils/return-to';
import { journeyQueryKeys } from './journey-queries';
import styles from './JourneyDetailPage.module.css';

export function JourneyDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [rulesOpen, setRulesOpen] = useState(false);
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
          <>
            <div className={styles.metadata}>
              <section className={styles.metadataItem} aria-label="所属活动">
                <Typography.Text type="secondary">所属活动</Typography.Text>
                <Link to={`/campaigns/${journey.campaign.id}`}>{journey.campaign.name}</Link>
                <Tag>{campaignStatusLabels[journey.campaign.status]}</Tag>
              </section>
              <section className={styles.metadataItem} aria-label="入口人群">
                <Typography.Text type="secondary">入口人群</Typography.Text>
                {journey.segment ? (
                  <>
                    <Link to={`/segments/${journey.segment.id}`}>{journey.segment.name}</Link>
                    <Button type="link" size="small" onClick={() => setRulesOpen(true)}>
                      查看完整规则
                    </Button>
                  </>
                ) : (
                  <Typography.Text>不限人群</Typography.Text>
                )}
              </section>
            </div>
            <div className={styles.metadata}>
              <div className={styles.metadataItem}>
                <Typography.Text type="secondary">说明</Typography.Text>
                <Typography.Text type="secondary">
                  {journey.description ?? '未填写'}
                </Typography.Text>
              </div>
              <Typography.Text type="secondary">
                创建者：{journey.createdBy.displayName}
              </Typography.Text>
              <Typography.Text type="secondary">
                创建于 {formatDateTime(journey.createdAt)}
              </Typography.Text>
              <Typography.Text type="secondary">
                更新于 {formatDateTime(journey.updatedAt)}
              </Typography.Text>
            </div>
          </>
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
      {journey !== undefined && (
        <>
          <JourneyVersionsSection journeyId={journey.id} />
          {journey.segment && (
            <EntrySegmentRulesDrawer
              open={rulesOpen}
              title="入口分群规则"
              name={journey.segment.name}
              rules={journey.segment.rules}
              onClose={() => setRulesOpen(false)}
            />
          )}
        </>
      )}
    </section>
  );
}
