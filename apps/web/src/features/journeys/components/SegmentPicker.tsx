import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Empty, Flex, Input, Modal, Pagination, Table, Typography } from 'antd';
import type { TableProps } from 'antd';
import { PAGE_SIZES, type SegmentListItem } from '@journeylens/shared';
import { getSegments, getSegment } from '@/services/segments';
import { ApiError, getApiErrorMessage, isSessionExpired } from '@/services/api';
import { segmentQueryKeys } from '@/features/segments/segment-queries';
import { SegmentRuleView } from '@/features/segments/components/SegmentRuleView';
import { formatDateTime } from '@/utils/format-date-time';
import { tableScrollX } from '@/utils/table-scroll';

type Props = {
  value?: string | null;
  onChange?: (value: string | null) => void;
};

export function SegmentPicker({ value, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  // 规则弹窗展示点击那一行已有的规则，不再额外读取详情。
  const [ruleSegment, setRuleSegment] = useState<SegmentListItem>();
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(PAGE_SIZES[0]);
  const toggleRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  // 候选列表变化只影响可选项，已选分群 id 始终由表单保留。
  const selectedQuery = useQuery({
    queryKey: segmentQueryKeys.detail(value ?? ''),
    queryFn: ({ signal }) => getSegment(value ?? '', signal),
    enabled: value !== null && value !== undefined,
    refetchOnWindowFocus: false,
  });
  const listQuery = useQuery({
    queryKey: segmentQueryKeys.list({ q: query || undefined, page, pageSize }),
    queryFn: ({ signal }) => getSegments({ q: query || undefined, page, pageSize }, signal),
    enabled: expanded,
  });
  const selected = selectedQuery.data;
  const selectedNotFound =
    selectedQuery.error instanceof ApiError && selectedQuery.error.status === 404;
  const pageData = listQuery.data;

  function search(): void {
    setQuery(searchText.trim());
    setPage(1);
  }

  function choose(segmentId: string): void {
    onChange?.(segmentId);
    setExpanded(false);
    // 候选行收起后卸载，焦点回到触发按钮，键盘操作不会丢失位置。
    toggleRef.current?.focus();
  }

  const columns: NonNullable<TableProps<SegmentListItem>['columns']> = [
    {
      title: '分群名称',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      render: (name: string) => <Typography.Text strong>{name}</Typography.Text>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 190,
      render: formatDateTime,
    },
    {
      title: '操作',
      key: 'action',
      className: 'table-operation-cell',
      width: 200,
      fixed: 'end',
      render: (_value: unknown, segment: SegmentListItem) => (
        <Flex gap={8}>
          <Button type="link" onClick={() => setRuleSegment(segment)}>
            查看分群规则
          </Button>
          <Button type="link" disabled={value === segment.id} onClick={() => choose(segment.id)}>
            {value === segment.id ? '已选择' : '选择'}
          </Button>
        </Flex>
      ),
    },
  ];

  return (
    <>
      <Flex align="center" gap={8} wrap>
        {value === null || value === undefined ? (
          <Typography.Text type="secondary">不限人群</Typography.Text>
        ) : selectedNotFound ? (
          <Typography.Text type="secondary">所选分群已不存在</Typography.Text>
        ) : selected !== undefined ? (
          <Flex vertical>
            <Typography.Text>{selected.name}</Typography.Text>
            {selectedQuery.error !== null && selectedQuery.error !== undefined && (
              <Typography.Text type="secondary">暂时无法确认分群是否有更新</Typography.Text>
            )}
          </Flex>
        ) : selectedQuery.error !== null && selectedQuery.error !== undefined ? (
          <Typography.Text type="secondary">
            {selectedQuery.error instanceof ApiError && selectedQuery.error.status === 404
              ? '所选分群已不存在'
              : '所选分群暂时无法读取'}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">正在读取所选分群…</Typography.Text>
        )}
        <Button
          ref={toggleRef}
          aria-expanded={expanded}
          onClick={() => setExpanded((previous) => !previous)}
        >
          {expanded ? '收起分群列表' : '展开分群列表'}
        </Button>
        {value !== null && value !== undefined && (
          <Button type="link" onClick={() => onChange?.(null)}>
            解除绑定
          </Button>
        )}
      </Flex>
      {expanded && (
        <section aria-label="选择入口分群" style={{ marginTop: 12 }}>
          <Flex gap={8} style={{ marginBottom: 16 }}>
            <Input
              aria-label="搜索分群"
              value={searchText}
              maxLength={100}
              placeholder="搜索分群名称或说明"
              onChange={(event) => setSearchText(event.target.value)}
              onPressEnter={search}
            />
            <Button type="primary" onClick={search}>
              查 询
            </Button>
          </Flex>
          {pageData === undefined && listQuery.isPending ? (
            <div role="status" aria-label="正在读取分群">
              正在读取分群…
            </div>
          ) : pageData === undefined &&
            listQuery.error !== null &&
            !isSessionExpired(listQuery.error) ? (
            <Alert
              type="error"
              showIcon
              title={getApiErrorMessage(listQuery.error)}
              action={<Button onClick={() => void listQuery.refetch()}>重试</Button>}
            />
          ) : pageData !== undefined ? (
            <>
              {listQuery.error !== null && !isSessionExpired(listQuery.error) && (
                <Alert
                  style={{ marginBottom: 16 }}
                  type="warning"
                  showIcon
                  title="分群列表暂时无法刷新，当前内容可能不是最新的"
                  action={<Button onClick={() => void listQuery.refetch()}>重试</Button>}
                />
              )}
              <Table<SegmentListItem>
                rowKey="id"
                columns={columns}
                dataSource={pageData.data}
                pagination={false}
                scroll={{ x: tableScrollX(columns) }}
                tableLayout="fixed"
                loading={listQuery.isFetching}
                locale={{
                  emptyText: <Empty description={query ? '没有符合条件的分群' : '暂无分群'} />,
                }}
              />
              <Flex justify="end" style={{ marginTop: 16 }}>
                <Pagination
                  current={pageData.page.page}
                  pageSize={pageData.page.pageSize}
                  total={pageData.page.total}
                  pageSizeOptions={[...PAGE_SIZES]}
                  showSizeChanger={{ id: 'segment-picker-page-size', 'aria-label': '每页条数' }}
                  showQuickJumper
                  disabled={listQuery.isFetching}
                  onChange={(nextPage, nextPageSize) => {
                    const validPageSize =
                      PAGE_SIZES.find((size) => size === nextPageSize) ?? pageSize;
                    setPage(nextPageSize === pageSize ? nextPage : 1);
                    setPageSize(validPageSize);
                  }}
                  showTotal={(total) => `共 ${total} 条`}
                />
              </Flex>
            </>
          ) : null}
        </section>
      )}
      <Modal
        title={ruleSegment === undefined ? '分群规则' : `${ruleSegment.name} 的分群规则`}
        open={ruleSegment !== undefined}
        width={720}
        zIndex={1100}
        closable={{ 'aria-label': '关闭分群规则' }}
        onCancel={() => setRuleSegment(undefined)}
        footer={<Button onClick={() => setRuleSegment(undefined)}>关闭</Button>}
        destroyOnHidden
      >
        {ruleSegment !== undefined && <SegmentRuleView rules={ruleSegment.rules} />}
      </Modal>
    </>
  );
}
