import { ThemeToggle } from '@/components/ThemeToggle';
import { useColorMode } from '@/app/ThemeProvider';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  InfoCircleOutlined,
  LockOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  Flex,
  Input,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useQuery } from '@tanstack/react-query';
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type EdgeTypes,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import { useLocation, useNavigate, useParams } from 'react-router';
import type { JourneyVersionNodeStats } from '@journeylens/shared';
import {
  JourneyCanvasNode,
  type JourneyCanvasFlowNode,
} from '@/features/journeys/components/JourneyCanvasNode';
import { EntrySegmentRulesDrawer } from '@/features/journeys/components/EntrySegmentRulesDrawer';
import { JourneyEdge } from '@/features/journeys/components/JourneyEdge';
import {
  branchText,
  JourneyVersionStatsSummary,
  JourneyVersionStatsTable,
} from '@/features/journeys/components/JourneyVersionStatsSection';
import { PageHeader } from '@/components/PageHeader';
import { fitViewOptions } from '@/features/journeys/hooks/useJourneyCanvas';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  toFlowEdge,
  toFlowNode,
} from '@/features/journeys/journey-canvas';
import { journeyNodeDetails } from '@/features/journeys/journey-node-details';
import { journeyVersionQueryKeys } from '@/features/journeys/journey-queries';
import {
  journeyNodeOptions,
  journeyNodeTypeLabels,
} from '@/features/journeys/journey-node-options';
import { ApiError, getApiErrorMessage, isSessionExpired } from '@/services/api';
import { getJourneyVersion, getJourneyVersionStats } from '@/services/journeys';
import { formatDateTime } from '@/utils/format-date-time';
import styles from './JourneyVersionPage.module.css';

const nodeTypes: NodeTypes = { journey: JourneyCanvasNode };
const edgeTypes: EdgeTypes = { journey: JourneyEdge };
const defaultEdgeOptions = { type: 'journey' as const, interactionWidth: 0 };
const versionTabs = [
  { key: 'stats', label: '统计明细' },
  { key: 'flow', label: '流程视图' },
];
const flowAriaLabels = {
  'node.a11yDescription.default':
    '这是已发布版本的步骤，按 Enter 或空格选中后可查看配置，不能移动或修改。',
  'edge.a11yDescription.default': '这是已发布版本的连线，不能修改。',
  'controls.ariaLabel': '画布控制',
  'controls.zoomIn.ariaLabel': '放大画布',
  'controls.zoomOut.ariaLabel': '缩小画布',
  'controls.fitView.ariaLabel': '适配可见内容',
};

type VersionView = 'stats' | 'flow';

type VersionPageState = {
  versionListSearch?: string;
  journeyDetailState?: unknown;
  fromJourneyStats?: { search: string };
};

export function JourneyVersionPage() {
  const { mode, switching, toggleMode } = useColorMode();
  const { id = '', versionId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const pageState = (location.state ?? null) as VersionPageState | null;
  const fromJourneyStats = pageState?.fromJourneyStats;
  const [activeView, setActiveView] = useState<VersionView>(
    fromJourneyStats === undefined ? 'flow' : 'stats',
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [searchValue, setSearchValue] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const flowInstance = useRef<ReactFlowInstance<JourneyCanvasFlowNode, Edge> | null>(null);
  const didFitFlow = useRef(false);

  const query = useQuery({
    queryKey: journeyVersionQueryKeys.detail(id, versionId),
    queryFn: ({ signal }) => getJourneyVersion(id, versionId, signal),
  });
  const version = query.data;
  const snapshot = version?.snapshot;
  const definition = snapshot?.definition;

  // 独立读取运行统计：同一结果同时驱动画布角标、版本汇总、明细表和步骤统计。
  const statsQuery = useQuery({
    queryKey: journeyVersionQueryKeys.stats(id, versionId),
    queryFn: ({ signal }) => getJourneyVersionStats(id, versionId, signal),
    enabled: version !== undefined,
  });
  const enteredCounts = useMemo(
    () => new Map(statsQuery.data?.nodes.map((node) => [node.nodeId, node.entered]) ?? []),
    [statsQuery.data],
  );

  const nodes = useMemo(
    () =>
      definition === undefined
        ? []
        : definition.nodes.map((node) => {
            const flowNode = toFlowNode(node, definition.layoutDirection);
            const enteredCount = enteredCounts.get(node.id);
            return {
              ...flowNode,
              selected: node.id === selectedNodeId,
              data: {
                ...flowNode.data,
                // 还没有读到统计时不显示角标，不把未读取的数据展示成 0。
                ...(enteredCount === undefined ? {} : { enteredCount }),
              },
            };
          }),
    [definition, selectedNodeId, enteredCounts],
  );
  const edges = useMemo(
    () => (definition === undefined ? [] : definition.edges.map(toFlowEdge)),
    [definition],
  );
  const selectedNode = definition?.nodes.find((node) => node.id === selectedNodeId);
  const selectedNodeStats = statsQuery.data?.nodes.find((node) => node.nodeId === selectedNodeId);
  const selectedNodeTypeLabel =
    selectedNode === undefined ? undefined : journeyNodeTypeLabels[selectedNode.type];
  const searchTerm = searchValue.trim().toLocaleLowerCase();
  const matchingNodes = useMemo(
    () =>
      definition?.nodes.flatMap((node, index) =>
        searchTerm.length > 0 && node.name.toLocaleLowerCase().includes(searchTerm)
          ? [{ node, index }]
          : [],
      ) ?? [],
    [definition, searchTerm],
  );
  // 用类型和顺序号区分重名步骤，并给候选项可访问名称。
  const searchOptions = matchingNodes.map(({ node, index }) => ({
    value: node.id,
    'aria-label': `${node.name}，${journeyNodeTypeLabels[node.type]}，第 ${index + 1} 步`,
    label: (
      <Flex justify="space-between" gap={16}>
        <span>{node.name}</span>
        <Typography.Text type="secondary">
          {journeyNodeTypeLabels[node.type]} · 第 {index + 1} 步
        </Typography.Text>
      </Flex>
    ),
  }));
  const filteredStatsNodes = useMemo(
    () =>
      statsQuery.data?.nodes.filter((node) => node.name.toLocaleLowerCase().includes(searchTerm)) ??
      [],
    [searchTerm, statsQuery.data],
  );

  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const loadError =
    query.error !== null && !notFound && !isSessionExpired(query.error)
      ? getApiErrorMessage(query.error)
      : undefined;

  // 地址切到另一版本时重置本地视图状态；普通页签切换不会触发该重置。
  useEffect(() => {
    setActiveView(fromJourneyStats === undefined ? 'flow' : 'stats');
    setSelectedNodeId(undefined);
    setSearchValue('');
  }, [fromJourneyStats, location.key, versionId]);

  function goBack(): void {
    if (fromJourneyStats !== undefined) {
      navigate(`/journey-stats${fromJourneyStats.search}`);
      return;
    }
    navigate(`/journeys/${id}${pageState?.versionListSearch ?? ''}`, {
      state: pageState?.journeyDetailState,
    });
  }

  function locateNode(nodeId: string): void {
    const node = definition?.nodes.find((item) => item.id === nodeId);
    if (node === undefined) return;
    setSelectedNodeId(node.id);
    setActiveView('flow');
    // 搜索定位优先保留目标步骤，避免随后整图适配把节点再次缩小到角落。
    didFitFlow.current = true;
    window.requestAnimationFrame(() => {
      // 明确选择步骤时只平移到目标节点，保留用户当前缩放比例。
      void flowInstance.current?.setCenter(
        node.position.x + NODE_WIDTH / 2,
        node.position.y + NODE_HEIGHT / 2,
        { duration: 250 },
      );
    });
  }

  function scheduleInitialFlowFit(instance: ReactFlowInstance<JourneyCanvasFlowNode, Edge>): void {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (didFitFlow.current) return;
        didFitFlow.current = true;
        void instance.fitView(fitViewOptions);
      });
    });
  }

  function changeView(key: string): void {
    const nextView = key as VersionView;
    setActiveView(nextView);
    const instance = flowInstance.current;
    if (nextView !== 'flow' || instance === null || didFitFlow.current) return;
    // 流程页可能先在隐藏状态挂载；等它可见后再适配，避免把零尺寸画布算进视野。
    scheduleInitialFlowFit(instance);
  }

  const displayedStats = (node: JourneyVersionNodeStats): Array<[string, string | number]> => [
    ['进入', node.entered],
    ['已完成', node.nodeType === 'message' ? `消息触达 ${node.completed} 次` : node.completed],
    ['当前等待中', node.waiting],
    ['失败', node.failed],
    ['已停止', node.stopped],
  ];

  return (
    <section className={styles.page} aria-label="已发布版本">
      <header className={styles.topbar}>
        <PageHeader
          back={
            <Button type="link" style={{ paddingInline: 0 }} onClick={goBack}>
              {fromJourneyStats === undefined ? '返回版本列表' : '返回旅程统计'}
            </Button>
          }
          title={
            <Flex align="center" gap={8} wrap>
              <span>{snapshot?.name ?? '已发布版本'}</span>
              {version !== undefined && <Tag>第 {version.versionNumber} 版</Tag>}
              {version !== undefined && (
                <Tag icon={<LockOutlined aria-hidden />}>已发布 · 只读</Tag>
              )}
              {version !== undefined && (
                <span className={styles.readOnlyNote}>
                  <LockOutlined aria-hidden />
                  <span>此版本内容已固定</span>
                  <Tooltip
                    title="已发布内容固定保存，不随当前编排或入口分群的修改而变化。"
                    placement="bottomLeft"
                    trigger={['hover', 'focus']}
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<InfoCircleOutlined aria-hidden />}
                      aria-label="查看版本固定说明"
                    />
                  </Tooltip>
                </span>
              )}
            </Flex>
          }
          actions={
            <Flex gap={8} wrap>
              <ThemeToggle mode={mode} switching={switching} onToggle={toggleMode} />
              <Button
                icon={<ReloadOutlined aria-hidden />}
                loading={statsQuery.isFetching}
                onClick={() => void statsQuery.refetch()}
              >
                刷新统计
              </Button>
              <Button onClick={() => navigate(`/journeys/${id}/editor`)}>查看当前编排</Button>
            </Flex>
          }
        />
        {version !== undefined && snapshot !== undefined && (
          <>
            <div className={styles.metadata}>
              <Typography.Text type="secondary">
                {version.publishedBy.displayName} 发布于 {formatDateTime(version.publishedAt)}
              </Typography.Text>
              <section className={styles.audienceSummary} aria-label="入口人群">
                <Typography.Text type="secondary">入口人群</Typography.Text>
                <Typography.Text strong className={styles.audienceName ?? ''}>
                  {snapshot.entrySegment?.name ?? '不限人群'}
                </Typography.Text>
                {snapshot.entrySegment !== null && (
                  <Button
                    type="link"
                    size="small"
                    aria-expanded={rulesOpen}
                    onClick={() => setRulesOpen(true)}
                  >
                    查看完整规则
                  </Button>
                )}
              </section>
              <Typography.Text
                type="secondary"
                className={styles.description ?? ''}
                ellipsis={{ tooltip: snapshot.description ?? '未填写旅程说明' }}
              >
                {snapshot.description ? `旅程说明：${snapshot.description}` : '未填写旅程说明'}
              </Typography.Text>
            </div>
          </>
        )}
      </header>

      {query.isPending && (
        <Flex justify="center" role="status" aria-label="正在读取版本" style={{ padding: 48 }}>
          <Spin />
        </Flex>
      )}
      {notFound && <Alert type="warning" showIcon title="版本不存在" />}
      {loadError !== undefined && (
        <Alert
          type="error"
          showIcon
          title={loadError}
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      )}

      {version !== undefined && snapshot !== undefined && definition !== undefined && (
        <>
          <JourneyVersionStatsSummary query={statsQuery} />
          <section className={styles.viewCard} aria-label="版本统计与流程">
            <Tabs
              className={styles.tabs ?? ''}
              activeKey={activeView}
              items={versionTabs}
              onChange={changeView}
            />
            <div className={styles.searchBar}>
              <AutoComplete
                value={searchValue}
                options={searchOptions}
                // 候选项已按输入筛选，关闭内置二次过滤（antd v6 收进 showSearch）。
                showSearch={{ filterOption: false }}
                className={styles.searchInput ?? ''}
                onChange={(value) => setSearchValue(value)}
                onSelect={(nodeId: string) => {
                  locateNode(nodeId);
                  // 选定匹配项不改写输入条件，切回明细仍保留原筛选。
                  setSearchValue(searchValue);
                }}
              >
                <Input
                  allowClear
                  aria-label="按步骤名称查找"
                  placeholder="按步骤名称查找"
                  prefix={<SearchOutlined aria-hidden />}
                />
              </AutoComplete>
              <Typography.Text type="secondary">
                {activeView === 'stats'
                  ? '点击步骤名称，在流程中定位'
                  : '选择匹配步骤，查看右侧运行统计'}
              </Typography.Text>
            </div>
            <div className={styles.viewArea}>
              <div
                className={`${styles.viewPane ?? ''} ${activeView === 'stats' ? (styles.activeView ?? '') : ''}`}
                aria-hidden={activeView !== 'stats'}
              >
                <JourneyVersionStatsTable
                  query={statsQuery}
                  nodes={filteredStatsNodes}
                  onLocate={locateNode}
                />
              </div>
              <div
                className={`${styles.viewPane ?? ''} ${activeView === 'flow' ? (styles.activeView ?? '') : ''}`}
                aria-hidden={activeView !== 'flow'}
              >
                <div className={styles.flowView}>
                  <div className={styles.flowWorkspace}>
                    <section className={styles.canvasPanel} aria-label="版本画布">
                      <header className={styles.canvasHeader}>
                        <Typography.Text strong>旅程流程</Typography.Text>
                        <Typography.Text type="secondary">点击步骤查看右侧统计</Typography.Text>
                      </header>
                      <div className={styles.canvas}>
                        <ReactFlow<JourneyCanvasFlowNode, Edge>
                          colorMode={mode}
                          key={versionId}
                          nodes={nodes}
                          edges={edges}
                          nodeTypes={nodeTypes}
                          edgeTypes={edgeTypes}
                          nodesDraggable={false}
                          nodesConnectable={false}
                          edgesReconnectable={false}
                          elementsSelectable
                          deleteKeyCode={null}
                          minZoom={0.25}
                          maxZoom={1.75}
                          defaultEdgeOptions={defaultEdgeOptions}
                          ariaLabelConfig={flowAriaLabels}
                          onInit={(instance) => {
                            flowInstance.current = instance;
                            didFitFlow.current = false;
                            if (activeView === 'flow') {
                              scheduleInitialFlowFit(instance);
                            }
                          }}
                          onNodesChange={(changes) => {
                            for (const change of changes) {
                              if (change.type === 'select') {
                                setSelectedNodeId((current) =>
                                  change.selected
                                    ? change.id
                                    : current === change.id
                                      ? undefined
                                      : current,
                                );
                              }
                            }
                          }}
                          multiSelectionKeyCode={null}
                          onPaneClick={() => setSelectedNodeId(undefined)}
                          proOptions={{ hideAttribution: true }}
                        >
                          <Background gap={22} size={1} />
                          <Controls position="top-right" showFitView showInteractive={false} />
                        </ReactFlow>
                      </div>
                    </section>
                    <Card
                      title="步骤统计"
                      className={styles.detailPanel ?? ''}
                      styles={{ body: { flex: 1, minHeight: 0, overflow: 'auto' } }}
                    >
                      {selectedNode === undefined ? (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="选择画布中的步骤查看运行统计与配置"
                        />
                      ) : (
                        <Flex vertical gap={12}>
                          <Flex gap={10} align="center" wrap>
                            <span className={styles.stepIcon ?? ''} aria-hidden>
                              {
                                journeyNodeOptions.find((item) => item.value === selectedNode.type)
                                  ?.icon
                              }
                            </span>
                            <Typography.Title
                              level={4}
                              style={{ margin: 0, overflowWrap: 'anywhere' }}
                            >
                              {selectedNode.name}
                            </Typography.Title>
                            <Tag>{selectedNodeTypeLabel}</Tag>
                          </Flex>
                          {statsQuery.data === undefined ? (
                            <Flex justify="center" role="status" aria-label="正在读取步骤统计">
                              {statsQuery.isPending ? (
                                <Spin />
                              ) : (
                                <Typography.Text type="secondary">
                                  统计暂时无法读取，请点击上方“刷新统计”按钮重试。
                                </Typography.Text>
                              )}
                            </Flex>
                          ) : selectedNodeStats === undefined ? (
                            <Typography.Text type="secondary">
                              当前步骤暂无统计信息。
                            </Typography.Text>
                          ) : (
                            <>
                              <div className={styles.stepStatsGrid}>
                                {displayedStats(selectedNodeStats).map(([label, value]) => (
                                  <div key={label} className={styles.stepStat}>
                                    <Typography.Text type="secondary">{label}</Typography.Text>
                                    <Typography.Text strong className={styles.stepStatValue ?? ''}>
                                      {value}
                                    </Typography.Text>
                                  </div>
                                ))}
                              </div>
                              {(selectedNodeStats.conditionBranch !== null ||
                                selectedNodeStats.waitOutcome !== null) && (
                                <div className={styles.branchStats}>
                                  <Typography.Text type="secondary">分支分布</Typography.Text>
                                  <Typography.Text strong>
                                    {branchText(selectedNodeStats)}
                                  </Typography.Text>
                                </div>
                              )}
                            </>
                          )}
                          <Collapse
                            className={styles.configCollapse ?? ''}
                            items={[
                              {
                                key: 'configuration',
                                label: '步骤配置',
                                children: (
                                  <Descriptions layout="vertical" column={1} colon={false}>
                                    {journeyNodeDetails(selectedNode).map((item) => (
                                      <Descriptions.Item key={item.label} label={item.label}>
                                        <div
                                          className={
                                            item.isMessageBody
                                              ? (styles.messageBody ?? '')
                                              : (styles.detailValue ?? '')
                                          }
                                        >
                                          {item.value}
                                        </div>
                                      </Descriptions.Item>
                                    ))}
                                  </Descriptions>
                                ),
                              },
                            ]}
                          />
                        </Flex>
                      )}
                    </Card>
                  </div>
                </div>
              </div>
            </div>
          </section>
          {snapshot.entrySegment !== null && (
            <EntrySegmentRulesDrawer
              open={rulesOpen}
              title="发布时的入口分群规则"
              name={snapshot.entrySegment.name}
              rules={snapshot.entrySegment.rules}
              onClose={() => setRulesOpen(false)}
            />
          )}
        </>
      )}
    </section>
  );
}
