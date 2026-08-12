import {
  Alert,
  Button,
  Collapse,
  ConfigProvider,
  Descriptions,
  Flex,
  Timeline,
  Typography,
} from 'antd';
import {
  COMPARISON_OPERATOR_LABELS,
  CONDITION_BRANCH_LABELS,
  JOURNEY_EVENT_TYPE_LABELS,
  JOURNEY_MESSAGE_CHANNELS,
  audienceField,
  getSegmentComparisonLabels,
  journeyEventField,
  type JourneyConditionRule,
  type JourneyEventFilter,
  type JourneyEventType,
  type JourneySimulationResult,
  type JourneySimulationScenario,
  type JourneySimulationStep,
  type SegmentRule,
  type SimulationEventCheck,
  type SimulationEvidenceValue,
  type SimulationField,
} from '@journeylens/shared';
import { formatElapsedDuration, formatWaitDuration } from '@/features/journeys/journey-wait';
import { journeyNodeOptions } from '@/features/journeys/journey-node-options';
import {
  formatSimulationEvent,
  formatSimulationTimePoint,
} from '@/features/journeys/simulation-display';
import { formatFieldValue } from '@/utils/format-field-value';
import styles from './JourneySimulationPanel.module.css';

function actualValue(actual: SimulationEvidenceValue, field: SimulationField | undefined): string {
  return formatFieldValue(actual.exists ? actual.value : undefined, field);
}

/** 比较条件的左值字段：用户资料查受众目录，进入行为属性查行为目录。 */
function ruleField(rule: JourneyConditionRule): SimulationField | undefined {
  if (rule.kind !== 'compare') return undefined;
  return rule.left.source === 'user'
    ? audienceField(rule.left.path)
    : journeyEventField(rule.left.eventType, rule.left.path);
}

function ruleText(rule: SegmentRule): string {
  if (rule.kind === 'all') return `全部满足（${rule.children.map(ruleText).join('；')}）`;
  if (rule.kind === 'any') return `任一满足（${rule.children.map(ruleText).join('；')}）`;
  if (rule.kind === 'not') return `不满足：${ruleText(rule.child)}`;
  const labels = getSegmentComparisonLabels(rule);
  const field = audienceField(rule.left.path);
  const value = rule.right === undefined ? '' : formatFieldValue(rule.right, field);
  return rule.operator === 'exists'
    ? `${labels.fieldLabel} ${labels.operatorLabel}`
    : `${labels.fieldLabel} ${labels.operatorLabel} ${value}`;
}

function filterText(eventType: JourneyEventType, filter: JourneyEventFilter): string {
  const field = journeyEventField(eventType, filter.path);
  if (filter.operator === 'exists') return `${field?.label ?? filter.path}已填写`;
  return `${field?.label ?? filter.path} ${COMPARISON_OPERATOR_LABELS[filter.operator]} ${formatFieldValue(filter.right, field)}`;
}

function conditionDescription(rule: JourneyConditionRule): string {
  if (rule.kind === 'event_count') {
    return [
      `${JOURNEY_EVENT_TYPE_LABELS[rule.eventType]}，近 ${formatWaitDuration(rule.windowSeconds)} ${COMPARISON_OPERATOR_LABELS[rule.operator]} ${rule.right} 次`,
      ...(rule.filter === undefined ? [] : [`筛选：${filterText(rule.eventType, rule.filter)}`]),
      ...(rule.sameProduct ? ['限同一商品'] : []),
    ].join('，');
  }
  if (rule.left.source === 'user')
    return ruleText(rule as Extract<SegmentRule, { kind: 'compare' }>);

  const field = journeyEventField(rule.left.eventType, rule.left.path);
  const right = rule.right === undefined ? '' : formatFieldValue(rule.right, field);
  return rule.operator === 'exists'
    ? `进入行为的${field?.label ?? '属性'}已填写`
    : `进入行为的${field?.label ?? '属性'} ${COMPARISON_OPERATOR_LABELS[rule.operator]} ${right}`;
}

const CHECK_REASON_LABELS: Record<SimulationEventCheck['reason'], string> = {
  counted: '计入次数',
  matched: '匹配并唤醒等待',
  not_yet: '尚未发生',
  outside_window: '不在这段时间内',
  wrong_type: '行为不同',
  filter_mismatch: '行为属性不符合筛选',
  product_missing: '没有商品信息',
  product_mismatch: '商品不同',
  already_used: '已在前一步等待中使用',
  not_checked: '本次等待已结束，未再检查',
};

function checkDetails(
  checks: readonly SimulationEventCheck[],
  scenario: JourneySimulationScenario,
) {
  return checks.map((check) => ({
    label: CHECK_REASON_LABELS[check.reason],
    value: formatSimulationEvent(scenario, check.eventId),
  }));
}

function conditionDetails(
  step: Extract<JourneySimulationStep, { nodeType: 'condition' }>,
  scenario: JourneySimulationScenario,
) {
  const common = [
    { label: '判断条件', value: conditionDescription(step.rule) },
    { label: '判断结果', value: step.matched ? '满足' : '不满足' },
    { label: '选择路径', value: CONDITION_BRANCH_LABELS[step.branch] },
  ];
  if (step.evidence.kind === 'event_count') {
    return [
      ...common,
      { label: '计算时刻', value: formatSimulationTimePoint(step.evidence.evaluatedAtSeconds) },
      {
        label: '统计时间范围',
        value: `${formatSimulationTimePoint(step.evidence.windowStartSeconds)} 至 ${formatSimulationTimePoint(step.evidence.windowEndSeconds)}（两端包含）`,
      },
      { label: '实际次数', value: `${step.evidence.count} 次` },
      ...checkDetails(step.evidence.checks, scenario),
    ];
  }

  const field = ruleField(step.rule);
  const source =
    step.rule.kind !== 'compare'
      ? '行为次数'
      : step.rule.left.source === 'user'
        ? '用户资料'
        : '进入行为属性';
  return [
    ...common,
    { label: '判断来源', value: source },
    ...(step.rule.kind === 'compare'
      ? [{ label: '实际值', value: actualValue(step.evidence.actual, field) }]
      : []),
  ];
}

function stepSummary(step: JourneySimulationStep): string {
  switch (step.nodeType) {
    case 'start':
      return `进入行为：${JOURNEY_EVENT_TYPE_LABELS[step.entryBehavior]}`;
    case 'condition': {
      // 摘要直接展示本次证据；分支“不满足”是正常结果，不作为执行错误展示。
      const branch = `走「${CONDITION_BRANCH_LABELS[step.branch]}」路径`;
      if (step.evidence.kind === 'event_count') {
        return `实际 ${step.evidence.count} 次 → ${branch}`;
      }
      const field = ruleField(step.rule);
      const value = `${field?.label ?? '实际值'}：${actualValue(step.evidence.actual, field)}`;
      return `${value} → ${branch}`;
    }
    case 'wait':
      return `累计等待 ${formatElapsedDuration(step.elapsedAfter)}`;
    case 'wait_for_event':
      return `${JOURNEY_EVENT_TYPE_LABELS[step.config.eventType]}：${step.outcome === 'matched' ? '等到行为' : '等待超时'}，${formatElapsedDuration(step.resolvedAtSeconds - step.startedAtSeconds)}`;
    case 'message': {
      const channel =
        JOURNEY_MESSAGE_CHANNELS.find((item) => item.value === step.channel)?.label ?? '';
      return `${channel}：${step.channel === 'email' ? (step.subject ?? '未填写主题') : step.body}`;
    }
    case 'end':
      return step.note ?? '旅程结束';
  }
}

function stepDetails(step: JourneySimulationStep, scenario: JourneySimulationScenario) {
  switch (step.nodeType) {
    case 'start':
      return [
        { label: '进入行为', value: JOURNEY_EVENT_TYPE_LABELS[step.entryBehavior] },
        { label: '行为信息', value: formatSimulationEvent(scenario, scenario.entryEvent.id) },
      ];
    case 'condition':
      return conditionDetails(step, scenario);
    case 'wait':
      return [
        { label: '本步等待', value: formatWaitDuration(step.waitSeconds) },
        { label: '进入时累计', value: formatElapsedDuration(step.elapsedBefore) },
        { label: '等待后累计', value: formatElapsedDuration(step.elapsedAfter) },
      ];
    case 'wait_for_event':
      return [
        { label: '等待行为', value: JOURNEY_EVENT_TYPE_LABELS[step.config.eventType] },
        { label: '最长等待', value: formatWaitDuration(step.config.waitSeconds) },
        ...(step.config.filter === undefined
          ? []
          : [{ label: '行为筛选', value: filterText(step.config.eventType, step.config.filter) }]),
        { label: '商品限制', value: step.config.sameProduct ? '与进入行为同一商品' : '不限商品' },
        { label: '等待开始', value: formatSimulationTimePoint(step.startedAtSeconds) },
        {
          label: '最晚时刻',
          value: `${formatSimulationTimePoint(step.deadlineSeconds)}（截止时刻不计入）`,
        },
        { label: '实际结束', value: formatSimulationTimePoint(step.resolvedAtSeconds) },
        { label: '结果', value: step.outcome === 'matched' ? '等到行为' : '等待超时' },
        ...(step.matchedEventId === null
          ? []
          : [{ label: '匹配行为', value: formatSimulationEvent(scenario, step.matchedEventId) }]),
        ...checkDetails(step.checks, scenario),
      ];
    case 'message':
      return [
        {
          label: '渠道',
          value: JOURNEY_MESSAGE_CHANNELS.find((item) => item.value === step.channel)?.label ?? '',
        },
        ...(step.subject === null ? [] : [{ label: '主题', value: step.subject }]),
        { label: '正文（仅预览）', value: step.body },
      ];
    case 'end':
      return step.note === null ? [] : [{ label: '结束说明', value: step.note }];
  }
}

/** 模拟结果：结论、入口依据和执行过程。只展示本次请求返回的数据，不查询真实受众。 */
export function SimulationResultView({
  result,
  visibleStepCount,
  scenario,
  onLocate,
}: {
  result: JourneySimulationResult;
  visibleStepCount: number;
  scenario: JourneySimulationScenario;
  onLocate: (nodeId: string) => void;
}) {
  const completed = result.outcome === 'completed';
  const playing = visibleStepCount < result.steps.length;
  const segment = result.admission.segment;
  return (
    <section className={styles.result ?? ''} aria-label="模拟结果" aria-live="polite">
      <div className={styles.outcome ?? ''}>
        <Alert
          type={playing ? 'info' : completed ? 'success' : 'warning'}
          showIcon
          title={playing ? '正在模拟' : completed ? '已到达结束步骤' : '未进入旅程'}
          description={
            completed ? (
              playing ? (
                `已走过 ${visibleStepCount} 步 · 每步间隔 0.5 秒`
              ) : undefined
            ) : (
              <ul className={styles.reasons ?? ''}>
                {!result.admission.entryBehavior.matched && <li>进入行为不匹配，没有进入旅程。</li>}
                {segment !== null && !segment.matched && <li>未满足入口分群“{segment.name}”。</li>}
              </ul>
            )
          }
          classNames={{ root: styles.outcomeAlert ?? '', title: styles.outcomeTitle ?? '' }}
        />
        <Collapse
          ghost
          size="small"
          expandIconPlacement="end"
          classNames={{ header: styles.admissionHeader ?? '', body: styles.admissionBody ?? '' }}
          items={[
            {
              key: 'admission',
              label: `入口分群：${segment === null ? '不限人群' : segment.matched ? '满足' : '不满足'}`,
              extra: <Typography.Text type="secondary">查看依据</Typography.Text>,
              children: (
                <Descriptions
                  size="small"
                  column={1}
                  colon={false}
                  classNames={{
                    label: styles.detailLabel ?? '',
                    content: styles.detailValue ?? '',
                  }}
                  items={[
                    {
                      key: 'user',
                      label: '本次用户',
                      children: result.user.displayName ?? '未填写昵称',
                    },
                    {
                      key: 'entry',
                      label: '进入行为',
                      children: `${JOURNEY_EVENT_TYPE_LABELS[result.admission.entryBehavior.actual]} · ${result.admission.entryBehavior.matched ? '匹配' : '不匹配'}`,
                    },
                    {
                      key: 'expected',
                      label: '要求的行为',
                      children: JOURNEY_EVENT_TYPE_LABELS[result.admission.entryBehavior.expected],
                    },
                    ...(segment === null
                      ? []
                      : [
                          { key: 'segment', label: '入口分群', children: segment.name },
                          { key: 'rule', label: '本次规则', children: ruleText(segment.rules) },
                          {
                            key: 'matched',
                            label: '判断',
                            children: segment.matched ? '满足' : '不满足',
                          },
                        ]),
                  ]}
                />
              ),
            },
          ]}
        />
      </div>
      {completed && (
        <div>
          <Flex justify="space-between" align="center" className={styles.stepsHeading ?? ''}>
            <Typography.Title level={5} className={styles.heading ?? ''}>
              执行过程
            </Typography.Title>
            <Typography.Text type="secondary" className={styles.meta ?? ''}>
              {playing ? `已走过 ${visibleStepCount} 步` : `共 ${result.steps.length} 步`}
            </Typography.Text>
          </Flex>
          <ConfigProvider theme={{ components: { Steps: { dotSize: 30, dotCurrentSize: 30 } } }}>
            <Timeline
              aria-label="模拟经过的步骤"
              className={styles.steps ?? ''}
              items={result.steps.slice(0, visibleStepCount).map((step) => {
                const details = stepDetails(step, scenario);
                const showSummary =
                  step.nodeType === 'condition' ||
                  step.nodeType === 'message' ||
                  step.nodeType === 'wait_for_event' ||
                  details.length === 0;
                return {
                  key: `${step.order}-${step.nodeId}`,
                  icon: (
                    <span className={styles.stepIcon ?? ''}>
                      {journeyNodeOptions.find((option) => option.value === step.nodeType)?.icon}
                    </span>
                  ),
                  content: (
                    <div className={styles.step ?? ''}>
                      <Flex justify="space-between" align="start" gap={8}>
                        <Typography.Text strong>{step.nodeName}</Typography.Text>
                        <Button type="link" size="small" onClick={() => onLocate(step.nodeId)}>
                          定位
                        </Button>
                      </Flex>
                      {showSummary && (
                        <Typography.Text type="secondary" className={styles.stepSummary ?? ''}>
                          {stepSummary(step)}
                        </Typography.Text>
                      )}
                      {details.length > 0 && (
                        <Collapse
                          ghost
                          size="small"
                          classNames={{
                            header: styles.disclosureHeader ?? '',
                            body: styles.disclosureBody ?? '',
                          }}
                          items={[
                            {
                              key: 'evidence',
                              label:
                                step.nodeType === 'message'
                                  ? '查看消息预览'
                                  : step.nodeType === 'condition'
                                    ? '查看判断详情'
                                    : step.nodeType === 'wait_for_event'
                                      ? '查看等待详情'
                                      : stepSummary(step),
                              children: (
                                <Descriptions
                                  size="small"
                                  column={1}
                                  colon={false}
                                  classNames={{
                                    label: styles.detailLabel ?? '',
                                    content: styles.detailValue ?? '',
                                  }}
                                  items={details.map((detail, index) => ({
                                    key: index,
                                    label: detail.label,
                                    children: detail.value,
                                  }))}
                                />
                              ),
                            },
                          ]}
                        />
                      )}
                    </div>
                  ),
                };
              })}
            />
          </ConfigProvider>
        </div>
      )}
    </section>
  );
}
