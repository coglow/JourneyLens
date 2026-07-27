import { useMemo, useState } from 'react';
import { InfoCircleOutlined, LockOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Flex, Spin, Tag, Tooltip, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Background, Controls, ReactFlow, type Edge, type NodeTypes } from '@xyflow/react';
import { useLocation, useNavigate, useParams } from 'react-router';
import {
  COMPARISON_OPERATOR_LABELS,
  JOURNEY_ENTRY_BEHAVIORS,
  JOURNEY_EVENT_TYPE_LABELS,
  JOURNEY_MESSAGE_CHANNELS,
  getSegmentComparisonLabels,
  journeyEventField,
  type JourneyDraftNode,
  type JourneyEventField,
} from '@journeylens/shared';
import {
  JourneyCanvasNode,
  type JourneyCanvasFlowNode,
} from '@/features/journeys/components/JourneyCanvasNode';
import { EntrySegmentRulesDrawer } from '@/features/journeys/components/EntrySegmentRulesDrawer';
import { PageHeader } from '@/components/PageHeader';
import { fitViewOptions } from '@/features/journeys/hooks/useJourneyCanvas';
import { toFlowEdge, toFlowNode } from '@/features/journeys/journey-canvas';
import { formatWaitDuration } from '@/features/journeys/journey-wait';
import { journeyVersionQueryKeys } from '@/features/journeys/journey-queries';
import { journeyNodeOptions } from '@/features/journeys/journey-node-options';
import { ApiError, getApiErrorMessage, isSessionExpired } from '@/services/api';
import { getJourneyVersion } from '@/services/journeys';
import { formatDateTime } from '@/utils/format-date-time';
import styles from './JourneyVersionPage.module.css';

const nodeTypes: NodeTypes = { journey: JourneyCanvasNode };
const defaultEdgeOptions = { type: 'smoothstep' as const, interactionWidth: 0 };
const flowAriaLabels = {
  'node.a11yDescription.default':
    '这是已发布版本的步骤，按 Enter 或空格选中后可查看配置，不能移动或修改。',
  'edge.a11yDescription.default': '这是已发布版本的连线，不能修改。',
  'controls.ariaLabel': '画布控制',
  'controls.zoomIn.ariaLabel': '放大画布',
  'controls.zoomOut.ariaLabel': '缩小画布',
  'controls.fitView.ariaLabel': '适配可见内容',
};

const NODE_TYPE_LABELS: Record<JourneyDraftNode['type'], string> = {
  start: '开始',
  condition: '条件分支',
  wait: '定时等待',
  wait_for_event: '等待行为',
  message: '消息',
  end: '结束',
};

type DetailItem = { label: string; value: string; isMessageBody?: boolean };

function comparisonText(operator: string, value: unknown, field?: JourneyEventField): string {
  if (operator === 'exists') return COMPARISON_OPERATOR_LABELS.exists;
  const valueText =
    field?.values?.find((item) => item.value === value)?.label ?? String(value ?? '');
  return `${COMPARISON_OPERATOR_LABELS[operator as keyof typeof COMPARISON_OPERATOR_LABELS]} ${valueText}`;
}

function nodeDetails(node: JourneyDraftNode): DetailItem[] {
  if (node.type === 'start') {
    return [
      {
        label: '进入行为',
        value:
          JOURNEY_ENTRY_BEHAVIORS.find((item) => item.value === node.entryBehavior)?.label ??
          node.entryBehavior,
      },
    ];
  }

  if (node.type === 'condition') {
    const rule = node.rules;
    if (rule.kind === 'event_count') {
      const filter = rule.filter;
      const filterField =
        filter === undefined ? undefined : journeyEventField(rule.eventType, filter.path);
      return [
        { label: '判断方式', value: `按${JOURNEY_EVENT_TYPE_LABELS[rule.eventType]}次数` },
        { label: '统计时间窗口', value: formatWaitDuration(rule.windowSeconds) },
        ...(filter === undefined
          ? []
          : [
              {
                label: '行为筛选',
                value: `${filterField?.label ?? filter.path} ${comparisonText(filter.operator, filter.right, filterField)}`,
              },
            ]),
        ...(rule.sameProduct ? [{ label: '商品范围', value: '只计算与进入行为同一商品' }] : []),
        { label: '次数条件', value: comparisonText(rule.operator, `${rule.right} 次`) },
      ];
    }
    if (rule.left.source === 'user') {
      const { fieldLabel, operatorLabel, valueText } = getSegmentComparisonLabels({
        kind: 'compare',
        left: rule.left,
        operator: rule.operator,
        ...(rule.right === undefined ? {} : { right: rule.right }),
      });
      return [
        { label: '判断方式', value: '用户资料' },
        { label: '条件', value: `${fieldLabel} ${operatorLabel} ${valueText}`.trim() },
      ];
    }
    const field = journeyEventField(rule.left.eventType, rule.left.path);
    return [
      { label: '判断方式', value: '进入行为属性' },
      { label: '进入行为', value: JOURNEY_EVENT_TYPE_LABELS[rule.left.eventType] },
      {
        label: '条件',
        value: `${field?.label ?? rule.left.path} ${comparisonText(rule.operator, rule.right, field)}`,
      },
    ];
  }

  if (node.type === 'wait') {
    return [{ label: '等待时长', value: formatWaitDuration(node.waitSeconds) }];
  }

  if (node.type === 'wait_for_event') {
    const field =
      node.filter === undefined ? undefined : journeyEventField(node.eventType, node.filter.path);
    return [
      { label: '等待行为', value: JOURNEY_EVENT_TYPE_LABELS[node.eventType] },
      { label: '最长等待时间', value: formatWaitDuration(node.waitSeconds) },
      ...(node.filter === undefined
        ? []
        : [
            {
              label: '行为筛选',
              value: `${field?.label ?? node.filter.path} ${comparisonText(node.filter.operator, node.filter.right, field)}`,
            },
          ]),
      ...(node.sameProduct ? [{ label: '商品范围', value: '只等待与进入行为同一商品' }] : []),
    ];
  }

  if (node.type === 'message') {
    return [
      ...(node.subject === null ? [] : [{ label: '邮件主题', value: node.subject }]),
      { label: '消息内容', value: node.body, isMessageBody: true },
    ];
  }

  if (node.type === 'end') {
    return [{ label: '结束说明', value: node.note ?? '未填写' }];
  }

  const exhaustive: never = node;
  return exhaustive;
}

type VersionPageState = { versionListSearch?: string; journeyDetailState?: unknown };

export function JourneyVersionPage() {
  const { id = '', versionId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [rulesOpen, setRulesOpen] = useState(false);

  const query = useQuery({
    queryKey: journeyVersionQueryKeys.detail(id, versionId),
    queryFn: ({ signal }) => getJourneyVersion(id, versionId, signal),
  });
  const version = query.data;
  const snapshot = version?.snapshot;
  const definition = snapshot?.definition;

  const nodes = useMemo(
    () =>
      definition === undefined
        ? []
        : definition.nodes.map((node) => ({
            ...toFlowNode(node, definition.layoutDirection),
            selected: node.id === selectedNodeId,
          })),
    [definition, selectedNodeId],
  );
  const edges = useMemo(
    () => (definition === undefined ? [] : definition.edges.map(toFlowEdge)),
    [definition],
  );
  const selectedNode = definition?.nodes.find((node) => node.id === selectedNodeId);
  const selectedNodeTypeLabel =
    selectedNode?.type === 'message'
      ? JOURNEY_MESSAGE_CHANNELS.find((item) => item.value === selectedNode.channel)?.label
      : selectedNode === undefined
        ? undefined
        : NODE_TYPE_LABELS[selectedNode.type];

  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const loadError =
    query.error !== null && !notFound && !isSessionExpired(query.error)
      ? getApiErrorMessage(query.error)
      : undefined;

  function backToVersions(): void {
    const state = (location.state ?? null) as VersionPageState | null;
    navigate(`/journeys/${id}${state?.versionListSearch ?? ''}`, {
      state: state?.journeyDetailState,
    });
  }

  return (
    <section className={styles.page} aria-label="已发布版本">
      <header className={styles.topbar}>
        <PageHeader
          back={
            <Button type="link" style={{ paddingInline: 0 }} onClick={backToVersions}>
              返回版本列表
            </Button>
          }
          title={snapshot?.name ?? '已发布版本'}
          actions={<Button onClick={() => navigate(`/journeys/${id}/editor`)}>查看当前编排</Button>}
        />
        {version !== undefined && snapshot !== undefined && (
          <>
            <div className={styles.metadata}>
              <Tag>第 {version.versionNumber} 版</Tag>
              <Tag icon={<LockOutlined aria-hidden />}>已发布 · 只读</Tag>
              <Typography.Text type="secondary">
                {version.publishedBy.displayName} 发布于 {formatDateTime(version.publishedAt)}
              </Typography.Text>
              <section className={styles.audienceSummary} aria-label="入口人群">
                <Typography.Text type="secondary">入口人群</Typography.Text>
                <Typography.Text strong className={styles.audienceName ?? ''}>
                  {snapshot.entrySegment?.name ?? '不限人群'}
                </Typography.Text>
                {snapshot.entrySegment !== null && (
                  <Button type="link" size="small" onClick={() => setRulesOpen(true)}>
                    查看完整规则
                  </Button>
                )}
              </section>
            </div>
            <div className={styles.notes}>
              <Typography.Text type="secondary">
                {snapshot.description ?? '未填写旅程说明'}
              </Typography.Text>
              <div className={styles.readOnlyNote}>
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
              </div>
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
          <div className={styles.workspace}>
            <section className={styles.canvasPanel} aria-label="版本画布">
              <header className={styles.canvasHeader}>
                <Typography.Text strong>旅程流程</Typography.Text>
                <Typography.Text type="secondary">点击步骤查看发布时的配置</Typography.Text>
              </header>
              <div className={styles.canvas}>
                <ReactFlow<JourneyCanvasFlowNode, Edge>
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  edgesReconnectable={false}
                  elementsSelectable
                  deleteKeyCode={null}
                  minZoom={0.25}
                  maxZoom={1.75}
                  fitView
                  fitViewOptions={fitViewOptions}
                  defaultEdgeOptions={defaultEdgeOptions}
                  ariaLabelConfig={flowAriaLabels}
                  onNodesChange={(changes) => {
                    for (const change of changes) {
                      if (change.type === 'select') {
                        setSelectedNodeId((current) =>
                          change.selected ? change.id : current === change.id ? undefined : current,
                        );
                      }
                    }
                  }}
                  multiSelectionKeyCode={null}
                  onPaneClick={() => setSelectedNodeId(undefined)}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={22} size={1} />
                  <Controls
                    position="bottom-left"
                    orientation="horizontal"
                    showFitView
                    showInteractive={false}
                  />
                </ReactFlow>
              </div>
            </section>
            <Card
              title="步骤详情"
              className={styles.detailPanel ?? ''}
              styles={{ body: { flex: 1, minHeight: 0, overflow: 'auto' } }}
            >
              {selectedNode === undefined ? (
                <Typography.Text type="secondary">选择画布中的步骤查看完整配置。</Typography.Text>
              ) : (
                <Flex vertical gap={24}>
                  <Flex gap={12} align="center" wrap>
                    <span className={styles.stepIcon} aria-hidden>
                      {journeyNodeOptions.find((item) => item.value === selectedNode.type)?.icon}
                    </span>
                    <Typography.Title level={4} style={{ margin: 0, overflowWrap: 'anywhere' }}>
                      {selectedNode.name}
                    </Typography.Title>
                    {selectedNodeTypeLabel !== selectedNode.name && (
                      <Tag>{selectedNodeTypeLabel}</Tag>
                    )}
                  </Flex>
                  <Descriptions layout="vertical" column={1} colon={false}>
                    {nodeDetails(selectedNode).map((item) => (
                      <Descriptions.Item key={item.label} label={item.label}>
                        <div
                          className={item.isMessageBody ? styles.messageBody : styles.detailValue}
                        >
                          {item.value}
                        </div>
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                </Flex>
              )}
            </Card>
          </div>
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
