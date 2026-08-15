import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Collapse,
  Descriptions,
  Drawer,
  Empty,
  Flex,
  Select,
  Spin,
  Tag,
  Typography,
} from 'antd';
import type { JourneyVersionDetail } from '@journeylens/shared';
import { Link, useLocation } from 'react-router';
import {
  diffJourneyVersions,
  JOURNEY_VERSION_DIFF_GROUP_LABELS,
  type JourneyVersionDiffItem,
} from '@/features/journeys/journey-version-diff';
import { journeyVersionQueryKeys } from '@/features/journeys/journey-queries';
import { SegmentRuleView } from '@/features/segments/components/SegmentRuleView';
import { getApiErrorMessage, isSessionExpired } from '@/services/api';
import { getJourneyVersion, getJourneyVersions } from '@/services/journeys';
import { formatDateTime } from '@/utils/format-date-time';
import styles from './JourneyVersionCompareDrawer.module.css';

type Props = {
  open: boolean;
  journeyId: string;
  onClose: () => void;
};

const VERSION_PICKER_PAGE_SIZE = 50;

function versionLabel(version: { versionNumber: number }): string {
  return `第 ${version.versionNumber} 版`;
}

function ChangeDetail({
  change,
  before,
  after,
}: {
  change: JourneyVersionDiffItem;
  before: JourneyVersionDetail;
  after: JourneyVersionDetail;
}) {
  if (change.group === 'meta') {
    return (
      <Flex vertical gap={4}>
        <Typography.Text type="secondary">旧：{change.before || '未填写'}</Typography.Text>
        <Typography.Text>新：{change.after || '未填写'}</Typography.Text>
      </Flex>
    );
  }

  if (change.group === 'segment') {
    if (!change.showRules) {
      return (
        <Typography.Text type="secondary">两版绑定的分群规则相同，人群范围一致。</Typography.Text>
      );
    }
    return (
      <Flex vertical gap={16}>
        {change.before !== null && (
          <section>
            <Typography.Text type="secondary">
              {versionLabel(before)} · {change.before.name}
            </Typography.Text>
            <SegmentRuleView rules={change.before.rules} />
          </section>
        )}
        {change.after !== null && (
          <section>
            <Typography.Text type="secondary">
              {versionLabel(after)} · {change.after.name}
            </Typography.Text>
            <SegmentRuleView rules={change.after.rules} />
          </section>
        )}
      </Flex>
    );
  }

  if (change.group === 'node-added' || change.group === 'node-removed') {
    return (
      <Descriptions
        size="small"
        column={1}
        bordered
        items={change.details.map((item) => ({
          key: item.label,
          label: item.label,
          children: (
            <span className={item.isMessageBody ? (styles.prewrap ?? '') : undefined}>
              {item.value || '—'}
            </span>
          ),
        }))}
      />
    );
  }

  if (change.group === 'node-updated') {
    return (
      <Flex vertical gap={12}>
        {change.textOnly && (
          <Typography.Text type="secondary">该步骤有改动，但文字表述与旧版相同。</Typography.Text>
        )}
        <Descriptions
          size="small"
          column={1}
          bordered
          items={change.details.map((row) => ({
            key: row.label,
            label: (
              <Flex gap={6} align="center">
                <span>{row.label}</span>
                {row.marked && <Tag color="blue">已调整</Tag>}
              </Flex>
            ),
            children: (
              <Flex vertical gap={2}>
                <Typography.Text type="secondary" className={styles.prewrap ?? ''}>
                  旧：{row.before || '—'}
                </Typography.Text>
                <Typography.Text className={styles.prewrap ?? ''}>
                  新：{row.after || '—'}
                </Typography.Text>
              </Flex>
            ),
          }))}
        />
      </Flex>
    );
  }

  if (change.group === 'edge') {
    return (
      <Typography.Text type="secondary">
        {change.added ? '这条连接是新增的。' : '这条连接已移除。'}
      </Typography.Text>
    );
  }

  return null;
}

export function JourneyVersionCompareDrawer({ open, journeyId, onClose }: Props) {
  const location = useLocation();
  const [olderId, setOlderId] = useState<string>();
  const [newerId, setNewerId] = useState<string>();

  const listQuery = useQuery({
    queryKey: journeyVersionQueryKeys.list(journeyId, {
      page: 1,
      pageSize: VERSION_PICKER_PAGE_SIZE,
    }),
    queryFn: ({ signal }) =>
      getJourneyVersions(journeyId, { page: 1, pageSize: VERSION_PICKER_PAGE_SIZE }, signal),
    enabled: open,
  });

  const versions = useMemo(() => listQuery.data?.data ?? [], [listQuery.data]);
  const total = listQuery.data?.page.total ?? 0;
  const newestId = versions[0]?.id;
  const secondId = versions[1]?.id;

  useEffect(() => {
    if (!open) return;
    setNewerId(newestId);
    setOlderId(secondId);
  }, [open, newestId, secondId]);

  const olderQuery = useQuery({
    queryKey: journeyVersionQueryKeys.detail(journeyId, olderId ?? ''),
    queryFn: ({ signal }) => getJourneyVersion(journeyId, olderId ?? '', signal),
    enabled: open && olderId !== undefined,
  });
  const newerQuery = useQuery({
    queryKey: journeyVersionQueryKeys.detail(journeyId, newerId ?? ''),
    queryFn: ({ signal }) => getJourneyVersion(journeyId, newerId ?? '', signal),
    enabled: open && newerId !== undefined,
  });

  const versionsById = useMemo(() => new Map(versions.map((item) => [item.id, item])), [versions]);

  const pair = useMemo(() => {
    const older = olderQuery.data;
    const newer = newerQuery.data;
    if (older === undefined || newer === undefined) return null;
    return older.versionNumber <= newer.versionNumber
      ? { before: older, after: newer }
      : { before: newer, after: older };
  }, [olderQuery.data, newerQuery.data]);

  const changes = useMemo(
    () => (pair === null ? [] : diffJourneyVersions(pair.before.snapshot, pair.after.snapshot)),
    [pair],
  );

  const versionOptions = versions.map((version) => ({
    value: version.id,
    label: versionLabel(version),
  }));

  // 不允许两侧选同一个版本：自己和自己比没有意义，也会让“没有差异”的提示产生歧义。
  const olderOptions = versionOptions.map((item) => ({
    ...item,
    disabled: item.value === newerId,
  }));
  const newerOptions = versionOptions.map((item) => ({
    ...item,
    disabled: item.value === olderId,
  }));

  function changeOlder(nextId: string): void {
    const next = versionsById.get(nextId);
    const currentNewer = newerId === undefined ? undefined : versionsById.get(newerId);
    if (
      next !== undefined &&
      currentNewer !== undefined &&
      next.versionNumber > currentNewer.versionNumber
    ) {
      setOlderId(newerId);
      setNewerId(nextId);
      return;
    }
    setOlderId(nextId);
  }

  function changeNewer(nextId: string): void {
    const next = versionsById.get(nextId);
    const currentOlder = olderId === undefined ? undefined : versionsById.get(olderId);
    if (
      next !== undefined &&
      currentOlder !== undefined &&
      next.versionNumber < currentOlder.versionNumber
    ) {
      setNewerId(olderId);
      setOlderId(nextId);
      return;
    }
    setNewerId(nextId);
  }

  const listError =
    listQuery.error !== null && !isSessionExpired(listQuery.error)
      ? getApiErrorMessage(listQuery.error)
      : undefined;
  const detailError = olderQuery.error ?? newerQuery.error;
  const loadError =
    detailError !== null && !isSessionExpired(detailError)
      ? getApiErrorMessage(detailError)
      : undefined;

  const retryList = (): void => {
    void listQuery.refetch();
  };

  const retryDetails = (): void => {
    if (olderId !== undefined) void olderQuery.refetch();
    if (newerId !== undefined) void newerQuery.refetch();
  };

  return (
    <Drawer title="版本对比" open={open} onClose={onClose} size={760}>
      <Flex vertical gap={16}>
        {listError !== undefined && (
          <Alert
            type="error"
            showIcon
            title={listError}
            action={<Button onClick={retryList}>重试</Button>}
          />
        )}

        <Flex gap={12} align="flex-end" wrap>
          <Flex vertical gap={4}>
            <Typography.Text type="secondary">较早的版本</Typography.Text>
            <Select
              aria-label="较早的版本"
              className={styles.picker ?? ''}
              value={olderId ?? null}
              options={olderOptions}
              onChange={changeOlder}
              disabled={listQuery.isPending}
            />
          </Flex>
          <Typography.Text type="secondary" className={styles.compareWord ?? ''}>
            对比
          </Typography.Text>
          <Flex vertical gap={4}>
            <Typography.Text type="secondary">较新的版本</Typography.Text>
            <Select
              aria-label="较新的版本"
              className={styles.picker ?? ''}
              value={newerId ?? null}
              options={newerOptions}
              onChange={changeNewer}
              disabled={listQuery.isPending}
            />
          </Flex>
        </Flex>

        {total > VERSION_PICKER_PAGE_SIZE && (
          <Typography.Text type="secondary">
            仅显示最近 {VERSION_PICKER_PAGE_SIZE} 个版本，更早的版本暂不支持对比。
          </Typography.Text>
        )}

        {versions.length > 0 && versions.length < 2 && (
          <Typography.Text type="secondary">至少发布两个版本后才能对比。</Typography.Text>
        )}

        {loadError !== undefined && (
          <Alert
            type="error"
            showIcon
            title={loadError}
            action={<Button onClick={retryDetails}>重试</Button>}
          />
        )}

        {pair === null && loadError === undefined && listError === undefined && (
          <Flex
            justify="center"
            role="status"
            aria-label="正在读取版本对比"
            style={{ padding: 32 }}
          >
            <Spin />
          </Flex>
        )}

        {pair !== null && (
          <>
            <Flex gap={24} wrap>
              {[pair.before, pair.after].map((version, index) => (
                <Flex key={`${version.id}-${index}`} vertical gap={2}>
                  <Link
                    to={`/journeys/${journeyId}/versions/${version.id}`}
                    state={{
                      versionListSearch: location.search,
                      journeyDetailState: location.state,
                    }}
                  >
                    <Typography.Text strong>{versionLabel(version)}</Typography.Text>
                  </Link>
                  <Typography.Text type="secondary">
                    {version.publishedBy.displayName} 发布于 {formatDateTime(version.publishedAt)}
                  </Typography.Text>
                </Flex>
              ))}
            </Flex>

            {changes.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="两个版本的流程配置没有差异"
              />
            ) : (
              <Collapse
                items={changes.map((change) => ({
                  key: change.key,
                  label: (
                    <Flex gap={8} align="center" wrap>
                      <Tag>{JOURNEY_VERSION_DIFF_GROUP_LABELS[change.group]}</Tag>
                      <span>{change.title}</span>
                    </Flex>
                  ),
                  children: (
                    <ChangeDetail change={change} before={pair.before} after={pair.after} />
                  ),
                }))}
              />
            )}
          </>
        )}
      </Flex>
    </Drawer>
  );
}
