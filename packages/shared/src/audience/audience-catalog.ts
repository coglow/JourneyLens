export const COMPARISON_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'exists',
] as const;

export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

export const COMPARISON_OPERATOR_LABELS = {
  eq: '等于',
  neq: '不等于',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  in: '属于',
  not_in: '不属于',
  contains: '包含',
  exists: '已填写',
} as const satisfies Record<ComparisonOperator, string>;

export const AUDIENCE_FIELD_GROUPS = [
  '基础信息',
  '人口画像',
  '会员价值',
  '购买与活跃',
  '偏好与触点',
] as const;

export type AudienceFieldGroup = (typeof AUDIENCE_FIELD_GROUPS)[number];

export type AudienceFieldKind = 'string' | 'number' | 'boolean' | 'string[]';

export interface AudienceFieldValue {
  value: string;
  label: string;
}

/**
 * 单个属性同时描述“怎么展示”和“怎么校验”：
 * operators 限定可选比较方式，precision 区分整数与金额。
 */
interface AudienceFieldShape {
  key: string;
  label: string;
  group: AudienceFieldGroup;
  kind: AudienceFieldKind;
  operators: readonly ComparisonOperator[];
  minimum?: number;
  precision?: 0 | 2;
  values?: readonly AudienceFieldValue[];
}

const NUMBER_FIELD_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'exists'] as const;
const ENUM_FIELD_OPERATORS = ['in', 'not_in', 'exists'] as const;
const BOOLEAN_FIELD_OPERATORS = ['eq', 'exists'] as const;

const CITY_VALUES = [
  '上海',
  '北京',
  '深圳',
  '杭州',
  '广州',
  '成都',
  '武汉',
  '南京',
  '重庆',
  '西安',
  '苏州',
  '郑州',
] as const;

const CITY_TIER_VALUES = [
  { value: 'tier1', label: '一线城市' },
  { value: 'tier2', label: '二线城市' },
  { value: 'tier3', label: '三线城市' },
] as const;

const GENDER_VALUES = [
  { value: 'female', label: '女' },
  { value: 'male', label: '男' },
] as const;

const OCCUPATION_VALUES = [
  { value: 'student', label: '学生' },
  { value: 'office', label: '白领' },
  { value: 'freelancer', label: '自由职业' },
  { value: 'retired', label: '退休' },
] as const;

const VIP_LEVEL_VALUES = [
  { value: 'normal', label: '普通' },
  { value: 'silver', label: '白银' },
  { value: 'gold', label: '黄金' },
  { value: 'platinum', label: '铂金' },
] as const;

const CATEGORY_VALUES = [
  { value: 'electronics', label: '数码电子' },
  { value: 'beauty', label: '美妆个护' },
  { value: 'fashion', label: '服饰鞋包' },
  { value: 'home', label: '家居生活' },
  { value: 'food', label: '食品生鲜' },
  { value: 'digital', label: '数字服务' },
] as const;

const CHANNEL_VALUES = [
  { value: 'app', label: 'App' },
  { value: 'wechat', label: '微信' },
  { value: 'web', label: '网页' },
  { value: 'offline', label: '线下' },
] as const;

const INTEREST_VALUES = [
  '数码',
  '游戏',
  '智能家居',
  '护肤',
  '彩妆',
  '香氛',
  '穿搭',
  '潮流',
  '运动',
  '家居',
  '收纳',
  '香薰',
  '美食',
  '咖啡',
  '零食',
  '会员',
  '云服务',
  '效率工具',
] as const;

export type AudienceCity = (typeof CITY_VALUES)[number];
export type AudienceCityTier = (typeof CITY_TIER_VALUES)[number]['value'];
export type AudienceGender = (typeof GENDER_VALUES)[number]['value'];
export type AudienceOccupation = (typeof OCCUPATION_VALUES)[number]['value'];
export type AudienceVipLevel = (typeof VIP_LEVEL_VALUES)[number]['value'];
export type AudienceProductCategory = (typeof CATEGORY_VALUES)[number]['value'];
export type AudienceChannel = (typeof CHANNEL_VALUES)[number]['value'];
export type AudienceInterest = (typeof INTEREST_VALUES)[number];

export const AUDIENCE_FIELDS = [
  {
    key: 'displayName',
    label: '昵称',
    group: '基础信息',
    kind: 'string',
    operators: ['eq', 'exists'],
  },
  {
    key: 'email',
    label: '邮箱',
    group: '基础信息',
    kind: 'string',
    operators: ['eq', 'contains', 'exists'],
  },
  {
    key: 'age',
    label: '年龄',
    group: '人口画像',
    kind: 'number',
    operators: NUMBER_FIELD_OPERATORS,
    minimum: 0,
    precision: 0,
  },
  {
    key: 'gender',
    label: '性别',
    group: '人口画像',
    kind: 'string',
    operators: ENUM_FIELD_OPERATORS,
    values: GENDER_VALUES,
  },
  {
    key: 'city',
    label: '城市',
    group: '人口画像',
    kind: 'string',
    operators: ENUM_FIELD_OPERATORS,
    values: CITY_VALUES.map((value) => ({ value, label: value })),
  },
  {
    key: 'cityTier',
    label: '城市层级',
    group: '人口画像',
    kind: 'string',
    operators: ENUM_FIELD_OPERATORS,
    values: CITY_TIER_VALUES,
  },
  {
    key: 'occupation',
    label: '职业',
    group: '人口画像',
    kind: 'string',
    operators: ENUM_FIELD_OPERATORS,
    values: OCCUPATION_VALUES,
  },
  {
    key: 'vipLevel',
    label: '会员等级',
    group: '会员价值',
    kind: 'string',
    operators: ENUM_FIELD_OPERATORS,
    values: VIP_LEVEL_VALUES,
  },
  {
    key: 'totalOrders',
    label: '累计订单数',
    group: '购买与活跃',
    kind: 'number',
    operators: NUMBER_FIELD_OPERATORS,
    minimum: 0,
    precision: 0,
  },
  {
    key: 'totalSpend',
    label: '累计消费额（元）',
    group: '购买与活跃',
    kind: 'number',
    operators: NUMBER_FIELD_OPERATORS,
    minimum: 0,
    precision: 2,
  },
  {
    key: 'avgOrderValue',
    label: '客单价（元）',
    group: '购买与活跃',
    kind: 'number',
    operators: NUMBER_FIELD_OPERATORS,
    minimum: 0,
    precision: 2,
  },
  {
    key: 'lastPurchaseDaysAgo',
    label: '最近购买距今天数',
    group: '购买与活跃',
    kind: 'number',
    operators: NUMBER_FIELD_OPERATORS,
    minimum: 0,
    precision: 0,
  },
  {
    key: 'lastActiveDaysAgo',
    label: '最近活跃距今天数',
    group: '购买与活跃',
    kind: 'number',
    operators: NUMBER_FIELD_OPERATORS,
    minimum: 0,
    precision: 0,
  },
  {
    key: 'purchaseCount30d',
    label: '近 30 天购买次数',
    group: '购买与活跃',
    kind: 'number',
    operators: NUMBER_FIELD_OPERATORS,
    minimum: 0,
    precision: 0,
  },
  {
    key: 'visitCount30d',
    label: '近 30 天访问次数',
    group: '购买与活跃',
    kind: 'number',
    operators: NUMBER_FIELD_OPERATORS,
    minimum: 0,
    precision: 0,
  },
  {
    key: 'preferredCategory',
    label: '偏好类目',
    group: '偏好与触点',
    kind: 'string',
    operators: ENUM_FIELD_OPERATORS,
    values: CATEGORY_VALUES,
  },
  {
    key: 'preferredChannel',
    label: '偏好渠道',
    group: '偏好与触点',
    kind: 'string',
    operators: ENUM_FIELD_OPERATORS,
    values: CHANNEL_VALUES,
  },
  {
    key: 'interests',
    label: '兴趣标签',
    group: '偏好与触点',
    kind: 'string[]',
    operators: ['contains', 'exists'],
    values: INTEREST_VALUES.map((value) => ({ value, label: value })),
  },
  {
    key: 'optInSms',
    label: '短信订阅',
    group: '偏好与触点',
    kind: 'boolean',
    operators: BOOLEAN_FIELD_OPERATORS,
  },
  {
    key: 'optInEmail',
    label: '邮件订阅',
    group: '偏好与触点',
    kind: 'boolean',
    operators: BOOLEAN_FIELD_OPERATORS,
  },
  {
    key: 'isBlacklisted',
    label: '黑名单标记',
    group: '偏好与触点',
    kind: 'boolean',
    operators: BOOLEAN_FIELD_OPERATORS,
  },
] as const satisfies readonly AudienceFieldShape[];

export type AudienceFieldKey = (typeof AUDIENCE_FIELDS)[number]['key'];

export const AUDIENCE_FIELD_KEYS: readonly AudienceFieldKey[] = AUDIENCE_FIELDS.map(
  (field) => field.key,
);

export interface AudienceField extends AudienceFieldShape {
  key: AudienceFieldKey;
}

/** 昵称和邮箱基础列，其余 19 个属性存放在 JSON 属性对象中。 */
export const AUDIENCE_COLUMN_KEYS = ['displayName', 'email'] as const;

export type AudienceColumnKey = (typeof AUDIENCE_COLUMN_KEYS)[number];

export type AudienceAttributeKey = Exclude<AudienceFieldKey, AudienceColumnKey>;

const AUDIENCE_FIELD_BY_KEY = new Map<string, AudienceField>(
  AUDIENCE_FIELDS.map((field) => [field.key, field]),
);

export function audienceField(key: string): AudienceField | undefined {
  return AUDIENCE_FIELD_BY_KEY.get(key);
}

export type AudienceAttributeValue = string | number | boolean | string[];

export type AudienceAttributes = Partial<Record<AudienceAttributeKey, AudienceAttributeValue>>;
