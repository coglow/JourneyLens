import { Flex, Input, InputNumber, Select, Checkbox, Typography } from 'antd';
import {
  AUDIENCE_FIELDS,
  COMPARISON_OPERATOR_LABELS,
  JOURNEY_ENTRY_BEHAVIOR_VALUES,
  JOURNEY_EVENT_TYPE_LABELS,
  JOURNEY_WAIT_MAX_SECONDS,
  journeyEventFields,
  journeyEventField,
  journeyEventHasProductId,
  type JourneyConditionRule,
  type JourneyEventFilter,
  type JourneyEventType,
  type SegmentRuleCompare,
} from '@journeylens/shared';
import { RuleCompareFields } from '@/components/RuleCompareFields';

type Props = {
  value: JourneyConditionRule;
  startBehavior: JourneyEventType | undefined;
  disabled?: boolean;
  onChange: (value: JourneyConditionRule) => void;
};

type ConditionSource = 'user' | 'entry_event' | 'event_count';

const NUMERIC_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;
const DEFAULT_EVENT_COUNT_WINDOW_SECONDS = 7 * 24 * 60 * 60;

function eventOperators(eventType: JourneyEventType, path: string) {
  const field = journeyEventField(eventType, path);
  if (field === undefined) return [];
  return field.kind === 'number'
    ? [...NUMERIC_OPERATORS, 'exists' as const]
    : field.values === undefined
      ? (['eq', 'neq', 'contains', 'exists'] as const)
      : (['eq', 'neq', 'exists'] as const);
}

/** 切换判断来源时给出可直接编辑的初始规则，不让界面停留在不合法的组合上。 */
function createUserCompareRule(): JourneyConditionRule {
  const field = AUDIENCE_FIELDS[0]!;
  return {
    kind: 'compare',
    left: { source: 'user', path: field.key },
    operator: field.operators[0]!,
  };
}

function createEntryEventCompareRule(
  eventType: JourneyEventType,
): JourneyConditionRule | undefined {
  const field = journeyEventFields(eventType)[0];
  if (field === undefined) return undefined;
  return {
    kind: 'compare',
    left: { source: 'entry_event', eventType, path: field.key },
    operator: field.kind === 'number' ? 'gte' : 'exists',
  };
}

function createEventCountRule(startBehavior: JourneyEventType | undefined): JourneyConditionRule {
  return {
    kind: 'event_count',
    eventType: 'purchase_completed',
    windowSeconds: DEFAULT_EVENT_COUNT_WINDOW_SECONDS,
    sameProduct: startBehavior === undefined || journeyEventHasProductId(startBehavior),
    operator: 'gte',
    right: 1,
  };
}

/** 三种判断来源共用一个切换入口，避免每个分支各写一份相同的选项和处理逻辑。 */
function ConditionSourceSelect({
  value,
  startBehavior,
  disabled,
  onChange,
}: {
  value: ConditionSource;
  startBehavior: JourneyEventType | undefined;
  disabled: boolean;
  onChange: (rule: JourneyConditionRule) => void;
}) {
  // 还没有开始步骤时按默认进入行为列出可选属性；保存时仍由草稿校验拦住不一致的组合。
  const entryEventType = startBehavior ?? 'product_viewed';
  const hasEntryFields = journeyEventFields(entryEventType).length > 0;

  return (
    <Flex vertical gap={8}>
      <Typography.Text strong>判断来源</Typography.Text>
      <Select
        aria-label="判断来源"
        disabled={disabled}
        value={value}
        options={[
          { label: '用户资料', value: 'user' },
          { label: '进入行为属性', value: 'entry_event', disabled: !hasEntryFields },
          { label: '行为发生次数', value: 'event_count' },
        ]}
        onChange={(source: ConditionSource) => {
          if (source === value) return;
          if (source === 'user') {
            onChange(createUserCompareRule());
            return;
          }
          if (source === 'entry_event') {
            const rule = createEntryEventCompareRule(entryEventType);
            if (rule !== undefined) onChange(rule);
            return;
          }
          onChange(createEventCountRule(startBehavior));
        }}
      />
    </Flex>
  );
}

function rightEditor(
  eventType: JourneyEventType,
  path: string,
  operator: string,
  value: unknown,
  onChange: (value: string | number | undefined) => void,
  label: string,
  disabled = false,
) {
  const field = journeyEventField(eventType, path);
  if (field === undefined || operator === 'exists') {
    return <Typography.Text type="secondary">不需要比较值</Typography.Text>;
  }
  if (field.kind === 'number') {
    return (
      <InputNumber
        aria-label={label}
        disabled={disabled}
        {...(field.minimum === undefined ? {} : { min: field.minimum })}
        {...(field.precision === undefined ? {} : { precision: field.precision })}
        value={typeof value === 'number' ? value : null}
        placeholder="请输入数字"
        style={{ width: '100%' }}
        onChange={(next) => onChange(next ?? undefined)}
      />
    );
  }
  if (field.values !== undefined) {
    return (
      <Select
        aria-label={label}
        disabled={disabled}
        value={typeof value === 'string' ? value : undefined}
        placeholder="请选择"
        options={field.values.map((item) => ({ label: item.label, value: item.value }))}
        onChange={onChange}
      />
    );
  }
  return (
    <Input
      aria-label={label}
      disabled={disabled}
      value={typeof value === 'string' ? value : ''}
      placeholder="请输入文字"
      onChange={(event) => onChange(event.target.value || undefined)}
    />
  );
}

export function JourneyEventFilterFields({
  eventType,
  value,
  onChange,
  label,
  disabled = false,
}: {
  eventType: JourneyEventType;
  value: JourneyEventFilter | undefined;
  onChange: (value: JourneyEventFilter | undefined) => void;
  label: string;
  disabled?: boolean;
}) {
  const eventFields = journeyEventFields(eventType);
  const hasFilterableFields = eventFields.length > 0;
  const field = value === undefined ? undefined : journeyEventField(eventType, value.path);
  const options = value === undefined ? [] : eventOperators(eventType, value.path);

  return (
    <Flex vertical gap={8}>
      <Checkbox
        disabled={disabled || !hasFilterableFields}
        checked={value !== undefined}
        onChange={(event) => {
          if (!event.target.checked) onChange(undefined);
          else {
            const first = eventFields[0];
            if (first !== undefined) onChange({ path: first.key, operator: 'exists' });
          }
        }}
      >
        按行为属性筛选
      </Checkbox>
      {/* 完成注册、开通订阅这类行为没有属性，开关保持禁用并说明原因。 */}
      {!hasFilterableFields && (
        <Typography.Text type="secondary">该行为没有可筛选的属性。</Typography.Text>
      )}
      {value !== undefined && (
        <>
          <Select
            aria-label={`${label}属性`}
            disabled={disabled}
            value={value.path}
            options={eventFields.map((item) => ({ label: item.label, value: item.key }))}
            onChange={(path: string) => {
              const nextOperators = eventOperators(eventType, path);
              const nextOperator = nextOperators[0] ?? 'exists';
              onChange({ path, operator: nextOperator });
            }}
          />
          <Select
            aria-label={`${label}比较方式`}
            disabled={disabled}
            value={value.operator}
            options={options.map((operator) => ({
              label: COMPARISON_OPERATOR_LABELS[operator],
              value: operator,
            }))}
            onChange={(operator) => onChange({ ...value, operator, right: undefined })}
          />
          {field !== undefined &&
            rightEditor(
              eventType,
              value.path,
              value.operator,
              value.right,
              (right) =>
                onChange({ ...value, ...(right === undefined ? { right: undefined } : { right }) }),
              `${label}比较值`,
              disabled,
            )}
        </>
      )}
    </Flex>
  );
}

export function JourneyConditionFields({
  value,
  startBehavior,
  disabled = false,
  onChange,
}: Props) {
  if (value.kind === 'compare' && value.left.source === 'user') {
    return (
      <Flex vertical gap={8}>
        <ConditionSourceSelect
          value="user"
          startBehavior={startBehavior}
          disabled={disabled}
          onChange={onChange}
        />
        <RuleCompareFields
          value={value as SegmentRuleCompare}
          label="条件"
          layout="stacked"
          disabled={disabled}
          onChange={(next) => onChange(next)}
        />
      </Flex>
    );
  }

  if (value.kind === 'compare' && value.left.source === 'entry_event') {
    const { eventType, path } = value.left;
    const source = (
      <ConditionSourceSelect
        value="entry_event"
        startBehavior={startBehavior}
        disabled={disabled}
        onChange={onChange}
      />
    );
    return (
      <Flex vertical gap={8}>
        {source}
        <Flex vertical gap={4}>
          <Typography.Text type="secondary">进入行为</Typography.Text>
          <Select
            aria-label="进入行为类型"
            disabled={disabled}
            value={eventType}
            options={JOURNEY_ENTRY_BEHAVIOR_VALUES.map((type) => ({
              label: JOURNEY_EVENT_TYPE_LABELS[type],
              value: type,
            }))}
            onChange={(nextType: JourneyEventType) => {
              const rule = createEntryEventCompareRule(nextType);
              if (rule !== undefined) onChange(rule);
            }}
          />
          {startBehavior !== undefined && startBehavior !== eventType && (
            <Typography.Text type="danger">请改为与开始步骤相同的进入行为。</Typography.Text>
          )}
        </Flex>
        <Flex vertical gap={4}>
          <Typography.Text type="secondary">行为属性</Typography.Text>
          <Select
            aria-label="进入行为属性"
            disabled={disabled}
            value={path}
            options={journeyEventFields(eventType).map((field) => ({
              label: field.label,
              value: field.key,
            }))}
            onChange={(nextPath: string) => {
              const nextField = journeyEventField(eventType, nextPath);
              if (nextField !== undefined) {
                onChange({
                  kind: 'compare',
                  left: { source: 'entry_event', eventType, path: nextPath as typeof path },
                  operator: nextField.kind === 'number' ? 'gte' : 'exists',
                });
              }
            }}
          />
        </Flex>
        <Select
          aria-label="旅程条件比较方式"
          disabled={disabled}
          value={value.operator}
          options={eventOperators(eventType, path).map((operator) => ({
            label: COMPARISON_OPERATOR_LABELS[operator],
            value: operator,
          }))}
          onChange={(operator) => onChange({ ...value, operator, right: undefined })}
        />
        {rightEditor(
          eventType,
          path,
          value.operator,
          value.right,
          (right) =>
            onChange({ ...value, ...(right === undefined ? { right: undefined } : { right }) }),
          '旅程条件比较值',
          disabled,
        )}
      </Flex>
    );
  }

  if (value.kind !== 'event_count') return null;
  const canSameProduct =
    journeyEventHasProductId(value.eventType) &&
    (startBehavior === undefined || journeyEventHasProductId(startBehavior));
  return (
    <Flex vertical gap={8}>
      <ConditionSourceSelect
        value="event_count"
        startBehavior={startBehavior}
        disabled={disabled}
        onChange={onChange}
      />
      <Select
        aria-label="统计行为类型"
        disabled={disabled}
        value={value.eventType}
        options={JOURNEY_ENTRY_BEHAVIOR_VALUES.map((type) => ({
          label: JOURNEY_EVENT_TYPE_LABELS[type],
          value: type,
        }))}
        onChange={(eventType: JourneyEventType) =>
          onChange({
            ...value,
            eventType,
            filter: undefined,
            sameProduct: value.sameProduct && journeyEventHasProductId(eventType),
          })
        }
      />
      <Flex vertical gap={4}>
        <Typography.Text type="secondary">统计时间窗口（秒）</Typography.Text>
        <InputNumber
          aria-label="统计时间窗口（秒）"
          disabled={disabled}
          min={1}
          max={JOURNEY_WAIT_MAX_SECONDS}
          precision={0}
          value={value.windowSeconds}
          style={{ width: '100%' }}
          // 清空时保留上一次的有效数字，不把 0 写进规则。
          onChange={(windowSeconds) => {
            if (windowSeconds !== null) onChange({ ...value, windowSeconds });
          }}
        />
      </Flex>
      <JourneyEventFilterFields
        eventType={value.eventType}
        value={value.filter}
        label="次数过滤"
        disabled={disabled}
        onChange={(filter) =>
          onChange({ ...value, ...(filter === undefined ? { filter: undefined } : { filter }) })
        }
      />
      <Checkbox
        checked={value.sameProduct}
        disabled={disabled || (!canSameProduct && !value.sameProduct)}
        onChange={(event) => onChange({ ...value, sameProduct: event.target.checked })}
      >
        只计算与进入行为同一商品
      </Checkbox>
      <Flex gap={8}>
        <Select
          aria-label="次数比较方式"
          disabled={disabled}
          value={value.operator}
          options={NUMERIC_OPERATORS.map((operator) => ({
            label: COMPARISON_OPERATOR_LABELS[operator],
            value: operator,
          }))}
          style={{ flex: 1 }}
          onChange={(operator) => onChange({ ...value, operator })}
        />
        <InputNumber
          aria-label="比较次数"
          disabled={disabled}
          min={0}
          precision={0}
          value={value.right}
          style={{ flex: 1 }}
          onChange={(right) => {
            if (right !== null) onChange({ ...value, right });
          }}
        />
      </Flex>
    </Flex>
  );
}
