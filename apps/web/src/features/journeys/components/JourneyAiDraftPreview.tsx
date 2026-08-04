import { useMemo, useRef, useState } from 'react';
import { CheckCircleFilled } from '@ant-design/icons';
import { Button, Descriptions, Drawer, Flex, Segmented, Tooltip, Typography } from 'antd';
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type EdgeTypes,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import type { JourneyDraftDefinition } from '@journeylens/shared';
import { JourneyCanvasNode, type JourneyCanvasFlowNode } from './JourneyCanvasNode';
import { JourneyEdge } from './JourneyEdge';
import { buildAiDraftChecklist } from '@/features/journeys/journey-ai-draft-checklist';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  toFlowEdge,
  toFlowNode,
} from '@/features/journeys/journey-canvas';
import { journeyNodeDetails } from '@/features/journeys/journey-node-details';
import { fitViewOptions } from '@/features/journeys/hooks/useJourneyCanvas';
import { journeyNodeTypeLabels } from '@/features/journeys/journey-node-options';
import styles from './JourneyAiDraftPreview.module.css';

const nodeTypes: NodeTypes = { journey: JourneyCanvasNode };
const edgeTypes: EdgeTypes = { journey: JourneyEdge };
const defaultEdgeOptions = { type: 'journey' as const, interactionWidth: 0 };
const flowAriaLabels = {
  'node.a11yDescription.default': '这是起草出来的步骤，按 Enter 或空格查看配置，不能移动或修改。',
  'edge.a11yDescription.default': '这是起草出来的连线，不能修改。',
  'controls.ariaLabel': '画布控制',
  'controls.zoomIn.ariaLabel': '放大画布',
  'controls.zoomOut.ariaLabel': '缩小画布',
  'controls.fitView.ariaLabel': '适配可见内容',
};

type Props = { definition: JourneyDraftDefinition };

export function JourneyAiDraftPreview({ definition }: Props) {
  const flowInstance = useRef<ReactFlowInstance<JourneyCanvasFlowNode, Edge> | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [view, setView] = useState('canvas');
  const nodes = useMemo(
    () =>
      definition.nodes.map((node) => ({
        ...toFlowNode(node, definition.layoutDirection),
        selected: node.id === selectedNodeId,
      })),
    [definition, selectedNodeId],
  );
  const edges = useMemo(() => definition.edges.map(toFlowEdge), [definition]);
  const checklist = useMemo(() => buildAiDraftChecklist(definition), [definition]);
  const selectedNode = definition.nodes.find((node) => node.id === selectedNodeId);

  function locateNode(nodeId: string): void {
    const node = definition.nodes.find((item) => item.id === nodeId);
    if (node === undefined) return;
    setView('canvas');
    setSelectedNodeId(nodeId);
    window.requestAnimationFrame(() => {
      void flowInstance.current?.setCenter(
        node.position.x + NODE_WIDTH / 2,
        node.position.y + NODE_HEIGHT / 2,
        { zoom: 1, duration: 200 },
      );
    });
  }

  return (
    <div className={styles.preview}>
      <div className={styles.toolbar}>
        <Flex align="center" gap={16} wrap>
          <Segmented
            aria-label="候选查看方式"
            value={view}
            options={[
              { label: '画布', value: 'canvas' },
              { label: '设置清单', value: 'list' },
            ]}
            onChange={setView}
          />
          <Tooltip title="已检查步骤配置和连接，业务含义仍需你核对并进行模拟。">
            <span role="status" className={styles.status}>
              <CheckCircleFilled /> 流程检查通过 · 待核对
            </span>
          </Tooltip>
          <Typography.Text type="secondary">{definition.nodes.length} 个步骤</Typography.Text>
        </Flex>
      </div>
      <div className={styles.previewCanvas} hidden={view !== 'canvas'}>
        <ReactFlow<JourneyCanvasFlowNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable
          deleteKeyCode={null}
          minZoom={0.15}
          maxZoom={1.75}
          fitView
          fitViewOptions={fitViewOptions}
          defaultEdgeOptions={defaultEdgeOptions}
          ariaLabelConfig={flowAriaLabels}
          onInit={(instance) => {
            flowInstance.current = instance;
          }}
          onNodesChange={(changes) => {
            for (const change of changes) {
              if (change.type === 'select')
                setSelectedNodeId((current) =>
                  change.selected ? change.id : current === change.id ? undefined : current,
                );
            }
          }}
          multiSelectionKeyCode={null}
          onPaneClick={() => setSelectedNodeId(undefined)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} size={1} />
          <Controls position="top-right" showFitView showInteractive={false} />
        </ReactFlow>
        <span className={styles.canvasHint}>点击步骤查看完整配置</span>
      </div>
      <div className={styles.checklist} hidden={view !== 'list'}>
        {checklist.map((entry) => (
          <section key={entry.node.id} className={styles.checklistItem}>
            <Flex align="center" justify="space-between" gap={8}>
              <Typography.Title level={5} className={styles.itemTitle ?? ''}>
                {entry.order}. {entry.node.name}
              </Typography.Title>
              <Flex align="center" gap={12}>
                <Typography.Text type="secondary">
                  {journeyNodeTypeLabels[entry.node.type]}
                </Typography.Text>
                <Button
                  type="link"
                  size="small"
                  aria-label={`在画布中定位${entry.node.name}`}
                  onClick={() => locateNode(entry.node.id)}
                >
                  定位
                </Button>
              </Flex>
            </Flex>
            <Descriptions
              size="small"
              column={1}
              bordered
              items={journeyNodeDetails(entry.node).map((item) => ({
                key: item.label,
                label: item.label,
                children: (
                  <span className={item.isMessageBody ? styles.messageBody : undefined}>
                    {item.value}
                  </span>
                ),
              }))}
            />
            {entry.next.length > 0 && (
              <Typography.Text type="secondary">
                去向：{entry.next.map((next) => `${next.label} → ${next.targetName}`).join('；')}
              </Typography.Text>
            )}
          </section>
        ))}
      </div>
      <Drawer
        title={selectedNode?.name ?? '步骤配置'}
        open={selectedNode !== undefined}
        onClose={() => setSelectedNodeId(undefined)}
        getContainer={false}
        mask={false}
        size="min(340px, 100%)"
        styles={{ root: { position: 'absolute' } }}
        destroyOnHidden
      >
        {selectedNode !== undefined && (
          <Descriptions
            size="small"
            column={1}
            items={journeyNodeDetails(selectedNode).map((item) => ({
              key: item.label,
              label: item.label,
              children: (
                <span className={item.isMessageBody ? styles.messageBody : undefined}>
                  {item.value}
                </span>
              ),
            }))}
          />
        )}
      </Drawer>
    </div>
  );
}
