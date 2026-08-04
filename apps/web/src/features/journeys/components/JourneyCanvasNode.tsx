import { useEffect, type ReactNode } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import {
  JOURNEY_ENTRY_BEHAVIORS,
  JOURNEY_EVENT_TYPE_LABELS,
  JOURNEY_MESSAGE_CHANNELS,
  audienceField,
  journeyEventField,
  type JourneyLayoutDirection,
  type JourneyDraftNode,
} from '@journeylens/shared';
import {
  BranchesOutlined,
  ClockCircleOutlined,
  FieldTimeOutlined,
  FlagOutlined,
  MessageOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Typography } from 'antd';
import { formatWaitDuration } from '@/features/journeys/journey-wait';
import { NODE_HEIGHT, NODE_WIDTH } from '@/features/journeys/journey-canvas';
import styles from './JourneyDraftEditor.module.css';

export type JourneyCanvasFlowNode = Node<
  {
    draftNode: JourneyDraftNode;
    layoutDirection: JourneyLayoutDirection;
    /** 仅用于展示本次模拟经过的步骤，不写入草稿。 */
    simulationState?: 'traversed';
    /** 已发布版本页展示的进入次数；未读到统计时不传，编辑器也不传。 */
    enteredCount?: number;
  },
  'journey'
>;

/** 节点类型标识：卡片内显示类型图标和名称。 */
const nodeTypeMeta: Record<JourneyDraftNode['type'], { label: string; icon: ReactNode }> = {
  start: { label: '开始', icon: <ThunderboltOutlined /> },
  condition: { label: '条件分支', icon: <BranchesOutlined /> },
  wait: { label: '定时等待', icon: <ClockCircleOutlined /> },
  wait_for_event: { label: '等待行为', icon: <FieldTimeOutlined /> },
  message: { label: '消息', icon: <MessageOutlined /> },
  end: { label: '结束', icon: <FlagOutlined /> },
};

function getNodeSummary(node: JourneyDraftNode): string {
  switch (node.type) {
    case 'start':
      return JOURNEY_ENTRY_BEHAVIORS.find((item) => item.value === node.entryBehavior)?.label ?? '';
    case 'condition': {
      if (node.rules.kind === 'event_count') {
        return `按${JOURNEY_EVENT_TYPE_LABELS[node.rules.eventType]}次数判断`;
      }
      const fieldLabel =
        node.rules.left.source === 'user'
          ? audienceField(node.rules.left.path)?.label
          : journeyEventField(node.rules.left.eventType, node.rules.left.path)?.label;
      const sourceLabel = node.rules.left.source === 'user' ? '用户' : '进入行为';
      return `按${sourceLabel}${fieldLabel ?? '属性'}判断`;
    }
    case 'wait':
      return `等待设置：${formatWaitDuration(node.waitSeconds)}`;
    case 'wait_for_event':
      return `等${JOURNEY_EVENT_TYPE_LABELS[node.eventType]}，最多${formatWaitDuration(node.waitSeconds)}`;
    case 'message': {
      const channelLabel =
        JOURNEY_MESSAGE_CHANNELS.find((item) => item.value === node.channel)?.label ?? '';
      // 邮件主题更短，卡片里用主题代替正文预览。
      const preview =
        node.channel === 'email' ? node.subject || '尚未填写主题' : node.body || '尚未填写内容';
      return `${channelLabel} · ${preview}`;
    }
    case 'end':
      return node.note ?? '旅程结束';
  }
}

export function JourneyCanvasNode({ id, data, selected }: NodeProps<JourneyCanvasFlowNode>) {
  const node = data.draftNode;
  const meta = nodeTypeMeta[node.type];
  const condition = node.type === 'condition';
  const eventWait = node.type === 'wait_for_event';
  const traversed = data.simulationState === 'traversed';
  const summary = getNodeSummary(node);
  // 连接点方向随草稿布局方向变化，确保重开时和保存坐标一致。
  const horizontal = data.layoutDirection === 'horizontal';
  const updateNodeInternals = useUpdateNodeInternals();
  // 方向改变不一定改变卡片尺寸，主动刷新连接点，连线和避让共用最新的测量结果。
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, horizontal, updateNodeInternals]);

  return (
    <article
      className={styles.canvasNode}
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
      data-node-type={node.type}
      data-selected={selected}
      data-simulation-state={traversed ? 'traversed' : undefined}
      aria-label={`${meta.label}：${node.name}${traversed ? '，本次模拟经过' : ''}`}
    >
      {node.type !== 'start' && (
        <Handle
          type="target"
          position={horizontal ? Position.Left : Position.Top}
          id="target"
          className={styles.targetHandle}
        />
      )}
      <div className={styles.nodeType}>
        <span className={styles.nodeTypeIcon} aria-hidden="true">
          {meta.icon}
        </span>
        <span className={styles.nodeTypeLabel}>{meta.label}</span>
        {/* 角标直接写出“进入 N 次”，避免被读成消息发送条数；0 也显示，与统计表保持一致。 */}
        {data.enteredCount !== undefined && (
          <span className={styles.enteredBadge}>进入 {data.enteredCount} 次</span>
        )}
      </div>
      <Typography.Text strong className={styles.nodeName ?? ''} ellipsis>
        {node.name}
      </Typography.Text>
      <Typography.Text className={styles.nodeSummary ?? ''} type="secondary" ellipsis>
        {summary}
      </Typography.Text>
      {condition || eventWait ? (
        <>
          <Handle
            type="source"
            position={horizontal ? Position.Top : Position.Left}
            id={condition ? 'met' : 'matched'}
            aria-label={condition ? '满足' : '等到行为'}
            style={horizontal ? { left: '38%' } : { top: '38%' }}
            className={`${styles.sourceHandle ?? ''} ${condition ? (styles.metHandle ?? '') : (styles.matchedHandle ?? '')}`}
          />
          <Handle
            type="source"
            position={horizontal ? Position.Bottom : Position.Right}
            id={condition ? 'unmet' : 'timeout'}
            aria-label={condition ? '不满足' : '超时'}
            style={horizontal ? { left: '72%' } : { top: '72%' }}
            className={`${styles.sourceHandle ?? ''} ${condition ? (styles.unmetHandle ?? '') : (styles.timeoutHandle ?? '')}`}
          />
        </>
      ) : (
        node.type !== 'end' && (
          <Handle
            type="source"
            position={horizontal ? Position.Right : Position.Bottom}
            id="next"
            className={styles.sourceHandle}
          />
        )
      )}
    </article>
  );
}
