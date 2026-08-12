import {
  JOURNEY_EVENT_TYPE_LABELS,
  journeyEventField,
  type JourneySimulationResult,
  type JourneySimulationScenario,
} from '@journeylens/shared';
import { formatFieldValue } from '@/utils/format-field-value';
import { formatElapsedDuration } from './journey-wait';

export function getSimulationHighlights(
  result: JourneySimulationResult | null,
  visibleStepCount: number,
) {
  return {
    nodeIds: new Set(result?.steps.slice(0, visibleStepCount).map((step) => step.nodeId)),
    edgeIds: new Set(result?.traversedEdgeIds.slice(0, Math.max(0, visibleStepCount - 1))),
  };
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
    return `${field?.label ?? key}：${formatFieldValue(value, field)}`;
  });
  return [
    [JOURNEY_EVENT_TYPE_LABELS[event.type], formatSimulationTimePoint(event.offsetSeconds)].join(
      ' · ',
    ),
    ...values,
  ].join('\n');
}
