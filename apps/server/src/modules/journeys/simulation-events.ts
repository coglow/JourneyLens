import type {
  JourneyEventFilter,
  JourneyEventType,
  JourneySimulationScenario,
  SimulationEventCheck,
} from '@journeylens/shared';
import { getEventMatchReason } from './event-matching.js';

export type SimulationFact = {
  id: string;
  type: JourneyEventType;
  offsetSeconds: number;
  payload: Record<string, unknown>;
};

/**
 * 合并三类行为并按发生时刻排序：历史行为为负偏移，进入行为固定为 0，后续行为为非负偏移。
 * 同一秒的行为用标识补齐排序，保证同一场景每次得到相同结果。
 */
export function buildSimulationFacts(scenario: JourneySimulationScenario): SimulationFact[] {
  return [scenario.entryEvent, ...scenario.historicalEvents, ...scenario.scheduledEvents]
    .map((event) => ({
      id: event.id,
      type: event.type,
      offsetSeconds: event.offsetSeconds,
      payload: event.payload,
    }))
    .sort(
      (left, right) =>
        left.offsetSeconds - right.offsetSeconds ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
}

/**
 * 统计滚动窗口内的行为次数；窗口是 [计算时刻 - 窗口长度, 计算时刻]，两端都包含。
 * 进入行为本身也在事实列表里，命中类型时同样计入，这样“进入时就已发生”的条件不需要另写分支。
 * 每个被排除的行为都记录原因，界面据此解释某条行为为什么没有计入。
 */
export function countMatchingEvents(input: {
  facts: readonly SimulationFact[];
  entryEvent: SimulationFact;
  atSeconds: number;
  eventType: JourneyEventType;
  windowSeconds: number;
  filter?: JourneyEventFilter;
  sameProduct: boolean;
}): { count: number; checks: SimulationEventCheck[] } {
  const start = input.atSeconds - input.windowSeconds;
  let count = 0;
  const checks: SimulationEventCheck[] = [];

  for (const fact of input.facts) {
    let reason: SimulationEventCheck['reason'];
    if (fact.offsetSeconds > input.atSeconds) reason = 'not_yet';
    else if (fact.offsetSeconds < start) reason = 'outside_window';
    else {
      reason =
        getEventMatchReason({
          candidate: fact,
          expectedType: input.eventType,
          filter: input.filter,
          entryEvent: input.entryEvent,
          sameProduct: input.sameProduct,
        }) ?? 'counted';
      if (reason === 'counted') count += 1;
    }
    checks.push({ eventId: fact.id, reason });
  }
  return { count, checks };
}

/**
 * 在等待窗口内找第一条符合条件的行为，找到就停在那一刻，否则等到截止时刻超时。
 * 只有后续行为能唤醒等待：历史行为和进入行为在等待开始前就已发生。
 * 窗口按 [开始时刻, 截止时刻) 计算，截止那一刻不算在内，与界面“截止时刻不计入”的说明一致。
 * 已被前一次等待用掉的行为标记为 already_used，避免同一条行为唤醒两次等待。
 */
export function waitForMatchingEvent(input: {
  scenario: JourneySimulationScenario;
  entryFact: SimulationFact;
  startedAtSeconds: number;
  waitSeconds: number;
  eventType: JourneyEventType;
  filter?: JourneyEventFilter;
  sameProduct: boolean;
  usedEventIds: ReadonlySet<string>;
}): {
  outcome: 'matched' | 'timeout';
  matchedEventId: string | null;
  resolvedAtSeconds: number;
  deadlineSeconds: number;
  checks: SimulationEventCheck[];
} {
  const deadlineSeconds = input.startedAtSeconds + input.waitSeconds;
  const events = input.scenario.scheduledEvents
    .map((event) => ({ ...event, payload: event.payload as Record<string, unknown> }))
    .sort(
      (left, right) =>
        left.offsetSeconds - right.offsetSeconds ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
  const checks: SimulationEventCheck[] = [];
  let matchedEventId: string | null = null;
  let resolvedAtSeconds = deadlineSeconds;

  for (const event of events) {
    if (event.offsetSeconds < input.startedAtSeconds || event.offsetSeconds >= deadlineSeconds) {
      checks.push({ eventId: event.id, reason: 'outside_window' });
      continue;
    }
    if (matchedEventId !== null) {
      checks.push({ eventId: event.id, reason: 'not_checked' });
      continue;
    }
    if (event.type !== input.eventType) {
      checks.push({ eventId: event.id, reason: 'wrong_type' });
      continue;
    }
    if (input.usedEventIds.has(event.id)) {
      checks.push({ eventId: event.id, reason: 'already_used' });
      continue;
    }
    const reason = getEventMatchReason({
      candidate: event,
      expectedType: input.eventType,
      filter: input.filter,
      entryEvent: input.entryFact,
      sameProduct: input.sameProduct,
    });
    if (reason !== undefined) {
      checks.push({ eventId: event.id, reason });
      continue;
    }
    matchedEventId = event.id;
    resolvedAtSeconds = event.offsetSeconds;
    checks.push({ eventId: event.id, reason: 'matched' });
  }

  return {
    outcome: matchedEventId === null ? 'timeout' : 'matched',
    matchedEventId,
    resolvedAtSeconds,
    deadlineSeconds,
    checks,
  };
}
