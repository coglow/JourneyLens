import {
  COMPARISON_OPERATOR_LABELS,
  JOURNEY_ENTRY_BEHAVIORS,
  JOURNEY_EVENT_TYPE_LABELS,
  JOURNEY_MESSAGE_CHANNELS,
  getSegmentComparisonLabels,
  journeyEventField,
  type ComparisonOperator,
  type JourneyDraftNode,
  type JourneyEventField,
} from '@journeylens/shared';
import { formatWaitDuration } from './journey-wait';
import { formatFieldValue } from '@/utils/format-field-value';

export type JourneyNodeDetailItem = {
  label: string;
  value: string;
  isMessageBody?: boolean;
};

function comparisonText(
  operator: ComparisonOperator,
  value: unknown,
  field?: JourneyEventField,
): string {
  if (operator === 'exists') return COMPARISON_OPERATOR_LABELS.exists;
  const valueText = value === undefined ? '' : formatFieldValue(value, field);
  return `${COMPARISON_OPERATOR_LABELS[operator]} ${valueText}`;
}

/**
 * 单个步骤的完整配置：已发布版本页与 AI 候选预览共用同一份汇总，
 * 避免两处对条件、时长、筛选、渠道和文案给出不一致的说法。
 */
export function journeyNodeDetails(node: JourneyDraftNode): JourneyNodeDetailItem[] {
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
      {
        label: '消息渠道',
        value:
          JOURNEY_MESSAGE_CHANNELS.find((item) => item.value === node.channel)?.label ??
          node.channel,
      },
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
