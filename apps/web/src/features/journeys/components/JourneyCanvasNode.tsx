import { useEffect, type ReactNode } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import {
  JOURNEY_ENTRY_BEHAVIORS,
  JOURNEY_MESSAGE_CHANNELS,
  audienceField,
  type JourneyLayoutDirection,
  type JourneyDraftNode,
} from '@journeylens/shared';
import {
  BranchesOutlined,
  ClockCircleOutlined,
  FlagOutlined,
  MessageOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Typography } from 'antd';
import { formatWaitDuration } from '@/features/journeys/journey-wait';
import { NODE_HEIGHT, NODE_WIDTH } from '@/features/journeys/journey-canvas';
import styles from './JourneyDraftEditor.module.css';

export type JourneyCanvasFlowNode = Node<
  { draftNode: JourneyDraftNode; layoutDirection: JourneyLayoutDirection },
  'journey'
>;

/** 节点类型标识：卡片内显示类型图标和名称。 */
const nodeTypeMeta: Record<JourneyDraftNode['type'], { label: string; icon: ReactNode }> = {
  start: { label: '开始', icon: <ThunderboltOutlined /> },
  condition: { label: '条件分支', icon: <BranchesOutlined /> },
  wait: { label: '定时等待', icon: <ClockCircleOutlined /> },
  message: { label: '消息', icon: <MessageOutlined /> },
  end: { label: '结束', icon: <FlagOutlined /> },
};

function getNodeSummary(node: JourneyDraftNode): string {
  switch (node.type) {
    case 'start':
      return JOURNEY_ENTRY_BEHAVIORS.find((item) => item.value === node.entryBehavior)?.label ?? '';
    case 'condition': {
      const fieldLabel = audienceField(node.rules.left.path)?.label;
      return `按${fieldLabel ?? '用户属性'}判断`;
    }
    case 'wait':
      return `等待设置：${formatWaitDuration(node.waitSeconds)}`;
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
      aria-label={`${meta.label}：${node.name}`}
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
      </div>
      <Typography.Text strong className={styles.nodeName ?? ''} ellipsis>
        {node.name}
      </Typography.Text>
      <Typography.Text className={styles.nodeSummary ?? ''} type="secondary" ellipsis>
        {getNodeSummary(node)}
      </Typography.Text>
      {condition ? (
        <>
          <Handle
            type="source"
            position={horizontal ? Position.Top : Position.Left}
            id="met"
            style={horizontal ? { left: '38%' } : { top: '38%' }}
            className={`${styles.sourceHandle ?? ''} ${styles.metHandle ?? ''}`}
          />
          <Handle
            type="source"
            position={horizontal ? Position.Bottom : Position.Right}
            id="unmet"
            style={horizontal ? { left: '72%' } : { top: '72%' }}
            className={`${styles.sourceHandle ?? ''} ${styles.unmetHandle ?? ''}`}
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
