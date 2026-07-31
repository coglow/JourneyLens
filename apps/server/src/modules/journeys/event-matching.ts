import {
  journeyEventHasProductId,
  type JourneyEventFilter,
  type JourneyEventType,
} from '@journeylens/shared';
import { compareSegmentValue } from '../segments/rule-evaluator.js';

export interface EventCandidate {
  type: JourneyEventType;
  payload: Record<string, unknown>;
}

/** 行为属性只读取请求里实际保存的字段，缺失与 null 区分开。 */
export function readEventPayloadValue(event: EventCandidate, path: string): unknown {
  return Object.hasOwn(event.payload, path) ? event.payload[path] : undefined;
}

export function eventFilterMatches(
  event: EventCandidate,
  filter: JourneyEventFilter | undefined,
): boolean {
  return (
    filter === undefined ||
    compareSegmentValue(readEventPayloadValue(event, filter.path), filter.operator, filter.right)
  );
}

/**
 * “限同一商品”的判断：进入行为和候选行为都要带商品 ID 才能比较。
 * 任何一侧没有商品 ID 都算信息不足，与商品不同分开返回，便于界面说明原因。
 */
export function eventProductMatchReason(
  entryEvent: EventCandidate,
  candidate: EventCandidate,
  sameProduct: boolean,
): 'product_missing' | 'product_mismatch' | undefined {
  if (!sameProduct) return undefined;
  if (!journeyEventHasProductId(entryEvent.type) || !journeyEventHasProductId(candidate.type)) {
    return 'product_missing';
  }
  const entryProduct = readEventPayloadValue(entryEvent, 'productId');
  const candidateProduct = readEventPayloadValue(candidate, 'productId');
  if (
    typeof entryProduct !== 'string' ||
    entryProduct.length === 0 ||
    typeof candidateProduct !== 'string' ||
    candidateProduct.length === 0
  ) {
    return 'product_missing';
  }
  return entryProduct === candidateProduct ? undefined : 'product_mismatch';
}

export type EventRejectReason =
  'wrong_type' | 'filter_mismatch' | 'product_missing' | 'product_mismatch';

/**
 * 模拟和实际运行共用的候选行为判断：类型、属性过滤和同商品都在这里，
 * undefined 表示命中。调用方自行决定是计数、唤醒等待还是记录未命中原因。
 */
export function getEventMatchReason(input: {
  candidate: EventCandidate;
  expectedType: JourneyEventType;
  filter?: JourneyEventFilter | undefined;
  entryEvent: EventCandidate;
  sameProduct: boolean;
}): EventRejectReason | undefined {
  if (input.candidate.type !== input.expectedType) return 'wrong_type';
  if (!eventFilterMatches(input.candidate, input.filter)) return 'filter_mismatch';
  return eventProductMatchReason(input.entryEvent, input.candidate, input.sameProduct);
}
