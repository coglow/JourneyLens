import { useState } from 'react';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  StopOutlined,
} from '@ant-design/icons';
import { Collapse, Descriptions, Tag, Typography } from 'antd';
import {
  COMPARISON_OPERATOR_LABELS,
  JOURNEY_BRANCH_LABELS,
  JOURNEY_EVENT_TYPE_LABELS,
  JOURNEY_MESSAGE_CHANNELS,
  audienceField,
  journeyEventField,
  type JourneyConditionRule,
  type JourneyEventField,
  type JourneyNodeType,
  type ExecutionTraceStep,
  type ExecutionTrace,
} from '@journeylens/shared';
import { formatDateTime } from '@/utils/format-date-time';
import { formatWaitDuration } from '@/features/journeys/journey-wait';
import { SegmentRuleView } from '@/features/segments/components/SegmentRuleView';
import { executionStepStatusLabels } from '../execution-status';
import styles from '../ExecutionDetailPage.module.css';

const NODE_TYPE_LABELS: Record<JourneyNodeType, string> = {
  start: '开始',
  condition: '条件判断',
  wait: '定时等待',
  wait_for_event: '等待行为',
  message: '消息',
  end: '结束',
};

type FieldDefinition = Pick<JourneyEventField, 'label' | 'values'>;

function optionLabel(
  field: FieldDefinition | undefined,
  value: unknown,
  fallback = '未填写',
): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    return value.map((item) => optionLabel(field, item)).join('、');
  }
  const option = field?.values?.find((item) => item.value === value);
  return option?.label ?? String(value);
}

function eventField(eventType: keyof typeof JOURNEY_EVENT_TYPE_LABELS, path: string) {
  return journeyEventField(eventType, path);
}

function compareText(
  operator: keyof typeof COMPARISON_OPERATOR_LABELS,
  right: unknown,
  field: FieldDefinition | undefined,
): string {
  if (operator === 'exists') return '已填写';
  return `${COMPARISON_OPERATOR_LABELS[operator]} ${optionLabel(field, right, '')}`.trim();
}

function conditionDescription(rule: JourneyConditionRule): string {
  if (rule.kind === 'event_count') {
    const filter = rule.filter;
    const filterField = filter === undefined ? undefined : eventField(rule.eventType, filter.path);
    const scope = [
      filter === undefined
        ? null
        : `${filterField?.label ?? filter.path} ${compareText(filter.operator, filter.right, filterField)}`,
      rule.sameProduct ? '限与进入行为同一商品' : null,
    ]
      .filter(Boolean)
      .join('，');
    return `按「${JOURNEY_EVENT_TYPE_LABELS[rule.eventType]}」次数（近 ${formatWaitDuration(rule.windowSeconds)}${scope ? `，${scope}` : ''}），次数条件：${COMPARISON_OPERATOR_LABELS[rule.operator]} ${rule.right} 次`;
  }

  if (rule.left.source === 'user') {
    const field = audienceField(rule.left.path);
    return `${field?.label ?? rule.left.path} ${compareText(rule.operator, rule.right, field)}`;
  }

  const field = eventField(rule.left.eventType, rule.left.path);
  return `进入行为「${JOURNEY_EVENT_TYPE_LABELS[rule.left.eventType]}」的${field?.label ?? rule.left.path} ${compareText(rule.operator, rule.right, field)}`;
}

type ConditionOutput = Extract<ExecutionTraceStep['output'], { kind: 'condition' }>;

function conditionActual(output: ConditionOutput): string {
  if (output.evidence.kind === 'event_count') {
    return `窗口 ${formatDateTime(output.evidence.windowStartAt)} 至 ${formatDateTime(output.evidence.windowEndAt)} 内实际 ${output.evidence.count} 次`;
  }

  const rule = output.rule;
  if (rule.kind !== 'compare' || !output.evidence.actual.exists) return '实际：未填写';
  const field =
    rule.left.source === 'user'
      ? audienceField(rule.left.path)
      : eventField(rule.left.eventType, rule.left.path);
  return `实际：${optionLabel(field, output.evidence.actual.value)}`;
}

function stepSummary(step: ExecutionTraceStep): string {
  if (step.status === 'stopped') return '活动停止，本步骤已终止';
  if (step.status === 'failed') return step.failureReason ?? '本步骤未能完成';
  const output = step.output;
  switch (output.kind) {
    case 'start':
      return `由「${JOURNEY_EVENT_TYPE_LABELS[output.entryBehavior]}」行为进入`;
    case 'condition': {
      const actual =
        output.evidence.kind === 'event_count'
          ? `实际 ${output.evidence.count} 次`
          : conditionActual(output);
      return `${actual}，走“${JOURNEY_BRANCH_LABELS[output.branch]}”路径`;
    }
    case 'wait':
      return step.status === 'waiting'
        ? `正在等待 ${formatWaitDuration(output.waitSeconds)}`
        : `已等待 ${formatWaitDuration(output.waitSeconds)}，继续下一步`;
    case 'wait_for_event':
      if (step.status === 'waiting')
        return `等待「${JOURNEY_EVENT_TYPE_LABELS[output.eventType]}」行为`;
      return output.outcome === 'matched'
        ? `已匹配${output.sameProduct ? '同商品' : ''}行为，走“等到行为”路径`
        : '等待到期，走“超时”路径';
    case 'message':
      return `${JOURNEY_MESSAGE_CHANNELS.find((item) => item.value === output.channel)?.label} · 演示发送`;
    case 'end':
      return output.note ?? '流程结束';
    case 'failed':
      return output.reason;
  }
}

function stepTime(step: ExecutionTraceStep): string {
  const time = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
  const start = time(step.startedAt);
  const end = step.endedAt === null ? null : time(step.endedAt);
  return end === null || end === start ? start : `${start} — ${end}`;
}

function stepDetails(step: ExecutionTraceStep, audienceName: string): string[] {
  const output = step.output;
  const details: string[] = [];

  if (output.kind === 'start') {
    details.push(`由「${JOURNEY_EVENT_TYPE_LABELS[output.entryBehavior]}」行为进入`);
  }

  if (output.kind === 'condition') {
    details.push(`条件：${conditionDescription(output.rule)}`);
    details.push(conditionActual(output));
    details.push(
      `结果：${output.matched ? '满足' : '不满足'}，走“${JOURNEY_BRANCH_LABELS[output.branch]}”路径`,
    );
    details.push(`判断时间：${formatDateTime(output.evidence.evaluatedAt)}`);
  }

  if (output.kind === 'wait') {
    details.push(`等待时长：${formatWaitDuration(output.waitSeconds)}`);
    if (step.deadlineAt !== null) details.push(`截止时间：${formatDateTime(step.deadlineAt)}`);
    if (step.status === 'waiting') details.push('正在等待到期，系统会继续检查');
    if (step.status === 'stopped') details.push('活动停止，等待已终止');
  }

  if (output.kind === 'wait_for_event') {
    const filter = output.filter;
    const filterField =
      filter === undefined ? undefined : eventField(output.eventType, filter.path);
    details.push(
      `等待行为：${JOURNEY_EVENT_TYPE_LABELS[output.eventType]}（最长 ${formatWaitDuration(output.waitSeconds)}）`,
    );
    if (filter !== undefined) {
      details.push(
        `行为筛选：${filterField?.label ?? filter.path} ${compareText(filter.operator, filter.right, filterField)}`,
      );
    }
    if (output.sameProduct) details.push('商品范围：只匹配与进入行为同一商品');
    if (step.deadlineAt !== null) {
      details.push(
        `等待窗口：${formatDateTime(step.startedAt)} 至 ${formatDateTime(step.deadlineAt)}（截止时刻不计入）`,
      );
    }
    if (step.status === 'stopped') {
      details.push('活动停止，等待已终止');
    } else if (step.status === 'waiting' || output.outcome === null) {
      details.push('正在等待匹配行为或到期');
    } else if (output.outcome === 'matched') {
      details.push(`等到匹配行为，行为 ID：${output.matchedEventId ?? '—'}`);
    } else {
      details.push('等待到期，未命中匹配行为');
    }
  }

  if (output.kind === 'message') {
    const channel = JOURNEY_MESSAGE_CHANNELS.find((item) => item.value === output.channel)?.label;
    details.push(`渠道：${channel ?? output.channel}`);
    if (output.subject !== null) details.push(`主题：${output.subject}`);
    details.push(`目标用户：${audienceName}`);
  }

  if (output.kind === 'end') {
    details.push(output.note ?? '流程结束');
  }

  if (output.kind === 'failed') {
    details.push(`未能继续：${output.reason}`);
  }

  if (step.status === 'failed' && step.failureReason !== null && output.kind !== 'failed') {
    details.push(`未能继续：${step.failureReason}`);
  }

  return details;
}

type ExecutionStepTrailProps = {
  steps: ExecutionTraceStep[];
  audienceName: string;
  entryEvidence: ExecutionTrace['entryEvidence'];
};

const statusIcons = {
  succeeded: CheckCircleFilled,
  waiting: ClockCircleOutlined,
  failed: CloseCircleFilled,
  stopped: StopOutlined,
};

/** 默认跟随等待或失败步骤；用户手动展开后保留其选择，轮询刷新不抢走阅读位置。 */
export function ExecutionStepTrail({
  steps,
  audienceName,
  entryEvidence,
}: ExecutionStepTrailProps) {
  const [expandedKeys, setExpandedKeys] = useState<string[]>();
  const attentionStep =
    steps.find((step) => step.status === 'failed') ??
    steps.find((step) => step.status === 'waiting');
  if (steps.length === 0) {
    return (
      <Typography.Text type="secondary">后台尚未开始处理这次执行，页面会自动刷新。</Typography.Text>
    );
  }

  return (
    <Collapse
      ghost
      expandIconPlacement="end"
      activeKey={expandedKeys ?? (attentionStep === undefined ? [] : [attentionStep.nodeId])}
      onChange={(keys) => setExpandedKeys(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
      items={steps.map((step) => {
        const Icon = statusIcons[step.status];
        return {
          key: step.nodeId,
          className: styles.stepItem ?? '',
          classNames: { header: styles.stepHeader ?? '', body: styles.stepBody ?? '' },
          label: (
            <div className={styles.stepLine}>
              <Icon
                className={`${styles.stepIcon ?? ''} ${styles[step.status] ?? ''}`}
                aria-label={executionStepStatusLabels[step.status]}
              />
              <span className={styles.stepName}>
                {step.order}. {step.nodeName}
              </span>
              <span className={styles.stepSummary}>{stepSummary(step)}</span>
              <span className={styles.stepTime}>{stepTime(step)}</span>
            </div>
          ),
          children: (
            <div className={styles.stepEvidence}>
              <div className={styles.stepMeta}>
                <Tag>{NODE_TYPE_LABELS[step.nodeType]}</Tag>
                <Typography.Text type="secondary">
                  {executionStepStatusLabels[step.status]}
                </Typography.Text>
                <Typography.Text type="secondary">
                  开始 {formatDateTime(step.startedAt)}
                </Typography.Text>
                {step.endedAt !== null && (
                  <Typography.Text type="secondary">
                    结束 {formatDateTime(step.endedAt)}
                  </Typography.Text>
                )}
              </div>
              {stepDetails(step, audienceName).map((detail) => (
                <Typography.Text key={detail} className={styles.breakable ?? ''}>
                  {detail}
                </Typography.Text>
              ))}
              {step.output.kind === 'start' && (
                <div className={styles.entryEvidence}>
                  <Typography.Text strong>
                    入口人群：{entryEvidence.segment?.name ?? '不限人群'}
                  </Typography.Text>
                  {entryEvidence.segment !== null && (
                    <>
                      <SegmentRuleView rules={entryEvidence.segment.rules} />
                      <Descriptions title="进入时用于判断的值" size="small" column={2}>
                        {entryEvidence.values.map(({ field, actual }) => (
                          <Descriptions.Item
                            key={field}
                            label={audienceField(field)?.label ?? field}
                          >
                            {actual.exists
                              ? optionLabel(audienceField(field), actual.value)
                              : '未填写'}
                          </Descriptions.Item>
                        ))}
                      </Descriptions>
                      <Typography.Text type="secondary">
                        这些值符合当时的入口规则，之后的资料变化不会改写这里。
                      </Typography.Text>
                    </>
                  )}
                </div>
              )}
              {step.output.kind === 'message' && (
                <>
                  <Typography.Text strong>消息内容</Typography.Text>
                  <Typography.Paragraph className={styles.messageBody ?? ''}>
                    {step.output.body}
                  </Typography.Paragraph>
                </>
              )}
            </div>
          ),
        };
      })}
    />
  );
}
