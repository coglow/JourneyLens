import { AUDIENCE_FIELDS } from '../audience/audience-catalog.js';

/** 模拟行为与开始步骤使用同一组静态类型，不维护第二份行为枚举。 */
export const JOURNEY_ENTRY_BEHAVIORS = [
  { value: 'product_viewed', label: '浏览商品' },
  { value: 'purchase_completed', label: '完成购买' },
  { value: 'reservation_created', label: '创建预约' },
  { value: 'app_session_started', label: '进入应用' },
  { value: 'app_exit', label: '退出应用' },
  { value: 'registration_completed', label: '完成注册' },
  { value: 'subscription_started', label: '开通订阅' },
] as const;

export type JourneyEventType = (typeof JOURNEY_ENTRY_BEHAVIORS)[number]['value'];
export const JOURNEY_EVENT_TYPES: readonly JourneyEventType[] = JOURNEY_ENTRY_BEHAVIORS.map(
  (item) => item.value,
);
export const JOURNEY_ENTRY_BEHAVIOR_VALUES = JOURNEY_EVENT_TYPES;

export type JourneyEventField = {
  key: JourneyEventFieldKey;
  label: string;
  kind: 'string' | 'number';
  maxLength?: number;
  minimum?: number;
  precision?: number;
  values?: readonly { value: string; label: string }[];
};

export type JourneyEventFieldKey =
  | 'reservationId'
  | 'productId'
  | 'productName'
  | 'category'
  | 'price'
  | 'sessionId'
  | 'orderId'
  | 'amount';

const categoryValues = AUDIENCE_FIELDS.find((field) => field.key === 'preferredCategory')!.values;

const eventFields: Record<JourneyEventType, readonly JourneyEventField[]> = {
  reservation_created: [
    { key: 'reservationId', label: '预约编号', kind: 'string', maxLength: 160 },
    { key: 'productId', label: '商品编号', kind: 'string', maxLength: 160 },
    { key: 'productName', label: '商品名称', kind: 'string', maxLength: 180 },
  ],
  product_viewed: [
    { key: 'productId', label: '商品编号', kind: 'string', maxLength: 160 },
    { key: 'productName', label: '商品名称', kind: 'string', maxLength: 180 },
    { key: 'category', label: '商品类目', kind: 'string', values: categoryValues },
    { key: 'price', label: '商品价格（元）', kind: 'number', minimum: 0, precision: 2 },
  ],
  app_session_started: [{ key: 'sessionId', label: '访问编号', kind: 'string', maxLength: 160 }],
  app_exit: [{ key: 'sessionId', label: '访问编号', kind: 'string', maxLength: 160 }],
  purchase_completed: [
    { key: 'orderId', label: '订单编号', kind: 'string', maxLength: 160 },
    { key: 'productId', label: '商品编号', kind: 'string', maxLength: 160 },
    { key: 'productName', label: '商品名称', kind: 'string', maxLength: 180 },
    { key: 'amount', label: '实付金额（元）', kind: 'number', minimum: 0, precision: 2 },
  ],
  registration_completed: [],
  subscription_started: [],
};

export function journeyEventField(
  eventType: JourneyEventType,
  key: string,
): JourneyEventField | undefined {
  return eventFields[eventType].find((field) => field.key === key);
}

export function journeyEventFields(eventType: JourneyEventType): readonly JourneyEventField[] {
  return eventFields[eventType];
}

export function journeyEventHasProductId(eventType: JourneyEventType): boolean {
  return journeyEventField(eventType, 'productId') !== undefined;
}

/** 行为类型沿用开始节点目录，界面和请求契约共用同一组值。 */
export const JOURNEY_EVENT_TYPE_LABELS = Object.fromEntries(
  JOURNEY_ENTRY_BEHAVIORS.map((item) => [item.value, item.label]),
) as Record<JourneyEventType, string>;
