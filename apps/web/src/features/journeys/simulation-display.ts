import {
  JOURNEY_EVENT_TYPE_LABELS,
  journeyEventField,
  type JourneySimulationScenario,
  type SimulationField,
} from '@journeylens/shared';
import { formatElapsedDuration } from './journey-wait';

type Scalar = string | number | boolean;

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** 枚举值取字段目录里的文案；受众属性和行为属性共用 values，缺失时回退原值。 */
function valueLabel(field: SimulationField | undefined, value: Scalar | null): string {
  if (value === null) return '未填写';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return field?.values?.find((option) => option.value === value)?.label ?? String(value);
}

/**
 * 模拟资料与结果证据共用的取值格式。
 * 传入字段目录才能把枚举显示成中文；null（设为空值）与缺失分开表达。
 */
export function formatSimulationValue(value: unknown, field?: SimulationField): string {
  if (value === null) return '未填写';
  if (Array.isArray(value)) {
    return value.length === 0
      ? '空列表'
      : value
          .map((item) => (isScalar(item) ? valueLabel(field, item) : JSON.stringify(item)))
          .join('、');
  }
  if (isScalar(value)) return valueLabel(field, value);
  return JSON.stringify(value);
}

/** 相对进入时刻的秒数转成文案；负数表示进入之前，零表示进入时刻。 */
export function formatSimulationTimePoint(seconds: number): string {
  if (seconds === 0) return '进入时';
  return seconds < 0
    ? `进入前 ${formatElapsedDuration(-seconds)}`
    : `进入后 ${formatElapsedDuration(seconds)}`;
}

/** 一条模拟行为的多行描述：行为类型与发生时刻，下面逐行列出已填写的属性。 */
export function formatSimulationEvent(
  scenario: JourneySimulationScenario,
  eventId: string,
): string {
  const event = [
    scenario.entryEvent,
    ...scenario.historicalEvents,
    ...scenario.scheduledEvents,
  ].find((item) => item.id === eventId);
  if (event === undefined) return `未找到行为 ${eventId}`;

  const values = Object.entries(event.payload).map(([key, value]) => {
    const field = journeyEventField(event.type, key);
    return `${field?.label ?? key}：${formatSimulationValue(value, field)}`;
  });
  return [
    [JOURNEY_EVENT_TYPE_LABELS[event.type], formatSimulationTimePoint(event.offsetSeconds)].join(
      ' · ',
    ),
    ...values,
  ].join('\n');
}
