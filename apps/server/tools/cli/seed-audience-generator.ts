/**
 * 演示受众生成器：Faker 只负责随机数，业务字段的分布和关联由下面的显式规则控制。
 * 固定种子和固定依赖版本保证可复现；调整随机调用顺序、种子或 Faker 版本都会换掉整套数据。
 */
import { faker } from '@faker-js/faker';
import type {
  AudienceAttributes,
  AudienceChannel,
  AudienceCity,
  AudienceCityTier,
  AudienceGender,
  AudienceInterest,
  AudienceOccupation,
  AudienceProductCategory,
  AudienceVipLevel,
} from '@journeylens/shared';

export const DEMO_AUDIENCE_COUNT = 2_000;
export const DEMO_AUDIENCE_SEED = 20_260_718;
export const DEMO_AUDIENCE_EXTERNAL_PREFIX = 'demo:audience:';

export interface DemoAudienceUser {
  id: string;
  externalId: string;
  displayName: string;
  email: string | null;
  attributes: AudienceAttributes;
}

// 城市和层级成对维护，避免生成“上海 / 三线城市”这种矛盾画像；权重只影响演示分布。
const CITY_CHOICES = [
  { weight: 8, value: { city: '上海', tier: 'tier1' } },
  { weight: 8, value: { city: '北京', tier: 'tier1' } },
  { weight: 6, value: { city: '深圳', tier: 'tier1' } },
  { weight: 6, value: { city: '杭州', tier: 'tier1' } },
  { weight: 7, value: { city: '广州', tier: 'tier1' } },
  { weight: 8, value: { city: '成都', tier: 'tier2' } },
  { weight: 7, value: { city: '武汉', tier: 'tier2' } },
  { weight: 6, value: { city: '南京', tier: 'tier2' } },
  { weight: 7, value: { city: '重庆', tier: 'tier2' } },
  { weight: 5, value: { city: '西安', tier: 'tier2' } },
  { weight: 5, value: { city: '苏州', tier: 'tier2' } },
  { weight: 12, value: { city: '郑州', tier: 'tier3' } },
] as const satisfies readonly {
  weight: number;
  value: { city: AudienceCity; tier: AudienceCityTier };
}[];

const CATEGORY_CHOICES = [
  { weight: 24, value: 'electronics' },
  { weight: 22, value: 'beauty' },
  { weight: 18, value: 'fashion' },
  { weight: 14, value: 'home' },
  { weight: 14, value: 'food' },
  { weight: 8, value: 'digital' },
] as const satisfies readonly { weight: number; value: AudienceProductCategory }[];

const CHANNEL_CHOICES = [
  { weight: 42, value: 'app' },
  { weight: 28, value: 'wechat' },
  { weight: 20, value: 'web' },
  { weight: 10, value: 'offline' },
] as const satisfies readonly { weight: number; value: AudienceChannel }[];

const INTEREST_POOL: Record<AudienceProductCategory, readonly AudienceInterest[]> = {
  electronics: ['数码', '游戏', '智能家居'],
  beauty: ['护肤', '彩妆', '香氛'],
  fashion: ['穿搭', '潮流', '运动'],
  home: ['家居', '收纳', '香薰'],
  food: ['美食', '咖啡', '零食'],
  digital: ['会员', '云服务', '效率工具'],
};

const CN_IMAGE = [
  '柠檬',
  '奶茶',
  '小笼包',
  '布丁',
  '薯条',
  '栗子',
  '桃子',
  '草莓',
  '芋圆',
  '米粒',
  '糖豆',
  '豆芽',
  '糯米',
  '奶昔',
  '泡芙',
  '蛋挞',
  '年糕',
  '麻薯',
  '果冻',
  '海盐',
  '青柠',
  '薄荷',
  '柚子',
  '葡萄',
  '西瓜',
  '樱桃',
  '山竹',
  '荔枝',
  '椰子',
  '蜜桃',
] as const;

const CN_SUFFIX = [
  '不酸',
  '三分甜',
  '不加糖',
  '爱吃鱼',
  '爱睡觉',
  '慢慢走',
  '圆圆',
  '白白',
  '软软',
  '糯糯',
  '香香',
  '甜甜',
  '的猫',
  '的狗',
  '的兔',
  '酱',
  '子',
  '儿',
  '宝宝',
  '殿下',
  '大王',
  '小姐',
  '先生',
  '大人',
  '仔',
  '宝',
  '不加醋',
  '爱喝汤',
  '要早起',
  '不熬夜',
] as const;

const EN_NICKNAMES = [
  'Kevin',
  'Lucy',
  'Tommy',
  'Aria',
  'Momo',
  'Niko',
  'Lily',
  'Evan',
  'Ivy',
  'Leo',
  'Mia',
  'Zoe',
  'Coco',
  'Jack',
  'Max',
  'Amy',
  'Owen',
  'Ruby',
  'Sky',
  'Daisy',
] as const;

const EMAIL_DOMAINS = ['example.com', 'example.net', 'example.org'] as const;

// 年龄按业务常见区间分桶，而不是均匀分布。
function pickAge(): number {
  const bucket = faker.number.float();
  if (bucket < 0.28) return faker.number.int({ min: 18, max: 25 });
  if (bucket < 0.62) return faker.number.int({ min: 26, max: 35 });
  if (bucket < 0.82) return faker.number.int({ min: 36, max: 45 });
  if (bucket < 0.94) return faker.number.int({ min: 46, max: 55 });
  return faker.number.int({ min: 56, max: 65 });
}

// 职业与年龄保持基本关联：学生偏年轻，退休偏年长；另有少量缺失。
function pickOccupation(age: number): AudienceOccupation | null {
  if (faker.number.float() < 0.08) return null;
  if (age <= 25) {
    return faker.helpers.weightedArrayElement<AudienceOccupation>([
      { weight: 70, value: 'student' },
      { weight: 25, value: 'office' },
      { weight: 5, value: 'freelancer' },
    ]);
  }
  if (age <= 45) {
    return faker.helpers.weightedArrayElement<AudienceOccupation>([
      { weight: 72, value: 'office' },
      { weight: 22, value: 'freelancer' },
      { weight: 3, value: 'student' },
      { weight: 3, value: 'retired' },
    ]);
  }
  if (age <= 55) {
    return faker.helpers.weightedArrayElement<AudienceOccupation>([
      { weight: 65, value: 'office' },
      { weight: 25, value: 'freelancer' },
      { weight: 10, value: 'retired' },
    ]);
  }
  return faker.helpers.weightedArrayElement<AudienceOccupation>([
    { weight: 80, value: 'retired' },
    { weight: 10, value: 'office' },
    { weight: 10, value: 'freelancer' },
  ]);
}

interface GeneratedOrders {
  totalOrders: number;
  totalSpend: number;
  avgOrderValue: number;
  lastPurchaseDaysAgo: number | null;
}

// 最近购买天数按“近期活跃、逐渐沉睡”的业务分布分桶。
function pickLastPurchaseDaysAgo(): number {
  const bucket = faker.number.float();
  if (bucket < 0.3) return faker.number.int({ min: 0, max: 7 });
  if (bucket < 0.55) return faker.number.int({ min: 8, max: 30 });
  if (bucket < 0.75) return faker.number.int({ min: 31, max: 90 });
  if (bucket < 0.9) return faker.number.int({ min: 91, max: 180 });
  return faker.number.int({ min: 181, max: 365 });
}

/**
 * 订单和消费一起生成：零订单用户不写购买字段；有订单用户保证订单数、消费额、
 * 客单价和最近购买天数互相自洽，避免每个字段独立乱填。
 */
function generateOrders(): GeneratedOrders {
  if (faker.number.float() < 0.15) {
    return { totalOrders: 0, totalSpend: 0, avgOrderValue: 0, lastPurchaseDaysAgo: null };
  }

  const totalOrders = 1 + Math.floor(faker.number.float() * faker.number.float() * 20);
  let spend = 0;
  for (let index = 0; index < totalOrders; index += 1) {
    spend += 50 + Math.floor(faker.number.float() * faker.number.float() * 1_200);
  }
  const totalSpend = Math.round(spend * 100) / 100;
  const avgOrderValue = Math.round((totalSpend / totalOrders) * 100) / 100;

  return {
    totalOrders,
    totalSpend,
    avgOrderValue,
    lastPurchaseDaysAgo: pickLastPurchaseDaysAgo(),
  };
}

// 会员等级先按业务比例抽取，再让高消费用户有更高概率升级，避免出现“高消费普通会员”。
function pickVipLevel(totalOrders: number, totalSpend: number): AudienceVipLevel {
  if (totalOrders === 0) {
    return faker.number.float() < 0.9 ? 'normal' : 'silver';
  }

  const bucket = faker.number.float();
  let level: AudienceVipLevel =
    bucket < 0.55 ? 'normal' : bucket < 0.82 ? 'silver' : bucket < 0.96 ? 'gold' : 'platinum';

  if (totalSpend >= 1_500 && level === 'normal' && faker.number.float() < 0.5) level = 'silver';
  if (
    totalSpend >= 4_000 &&
    level !== 'gold' &&
    level !== 'platinum' &&
    faker.number.float() < 0.45
  ) {
    level = 'gold';
  }
  if (totalSpend >= 8_000 && level !== 'platinum' && faker.number.float() < 0.3) level = 'platinum';
  return level;
}

// 访问次数与最近活跃时间相关：越久没活跃，近 30 天访问次数通常越少。
function pickVisitCount30d(lastActiveDaysAgo: number): number {
  if (lastActiveDaysAgo <= 2) return faker.number.int({ min: 4, max: 20 });
  if (lastActiveDaysAgo <= 7) return faker.number.int({ min: 3, max: 15 });
  if (lastActiveDaysAgo <= 15) return faker.number.int({ min: 2, max: 12 });
  if (lastActiveDaysAgo <= 30) return faker.number.int({ min: 1, max: 9 });
  if (lastActiveDaysAgo <= 90) return faker.number.int({ min: 0, max: 7 });
  return faker.number.int({ min: 0, max: 4 });
}

// 兴趣标签优先从偏好类目的标签池里选；少量用户为空数组或直接缺失，用于验证两种语义。
function pickInterests(category: AudienceProductCategory): AudienceInterest[] | null {
  const bucket = faker.number.float();
  if (bucket < 0.03) return null;
  if (bucket < 0.11) return [];

  const count = faker.number.int({ min: 1, max: 3 });
  return faker.helpers.arrayElements(INTEREST_POOL[category], count);
}

function createDisplayName(used: Set<string>): string {
  const base =
    faker.number.float() < 0.12
      ? `${faker.helpers.arrayElement(EN_NICKNAMES)}_${faker.number.int({ min: 100, max: 9_999 })}`
      : `${faker.helpers.arrayElement(CN_IMAGE)}${faker.helpers.arrayElement(CN_SUFFIX)}`;

  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function createEmail(used: Set<string>): string {
  const local = String(faker.number.int({ min: 10_000_000, max: 99_999_999 }));
  let candidate = `${local}@${faker.helpers.arrayElement(EMAIL_DOMAINS)}`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${local}${suffix}@${faker.helpers.arrayElement(EMAIL_DOMAINS)}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

/**
 * 生成固定演示受众。调用顺序就是随机序列的一部分，改动字段生成顺序会改变全部数据；
 * 改完后必须重新运行 seed、重新核对演示分群人数。
 */
export function generateDemoAudience(): DemoAudienceUser[] {
  faker.seed(DEMO_AUDIENCE_SEED);
  const usedNames = new Set<string>();
  const usedEmails = new Set<string>();
  const users: DemoAudienceUser[] = [];

  for (let index = 0; index < DEMO_AUDIENCE_COUNT; index += 1) {
    const age = pickAge();
    const gender: AudienceGender | null =
      faker.number.float() < 0.06 ? null : faker.number.float() < 0.52 ? 'female' : 'male';
    const city = faker.helpers.weightedArrayElement<{ city: AudienceCity; tier: AudienceCityTier }>(
      CITY_CHOICES,
    );
    const occupation = pickOccupation(age);
    const orders = generateOrders();
    const vipLevel = pickVipLevel(orders.totalOrders, orders.totalSpend);
    // 最近活跃不会早于最近购买（天数更小表示更近）；零订单用户只按 0–90 天随机。
    const lastActiveDaysAgo =
      orders.lastPurchaseDaysAgo === null
        ? faker.number.int({ min: 0, max: 90 })
        : faker.number.int({ min: 0, max: orders.lastPurchaseDaysAgo });
    // 只有最近 30 天内买过的人才可能有近 30 天购买次数，且不能超过累计订单数。
    const purchaseCount30d =
      orders.lastPurchaseDaysAgo !== null && orders.lastPurchaseDaysAgo <= 30
        ? faker.number.int({ min: 1, max: Math.min(orders.totalOrders, 8) })
        : 0;
    const visitCount30d = pickVisitCount30d(lastActiveDaysAgo);
    const preferredCategory =
      faker.helpers.weightedArrayElement<AudienceProductCategory>(CATEGORY_CHOICES);
    const preferredChannel = faker.helpers.weightedArrayElement<AudienceChannel>(CHANNEL_CHOICES);
    const interests = pickInterests(preferredCategory);
    const displayName = createDisplayName(usedNames);
    const email = faker.number.float() < 0.25 ? null : createEmail(usedEmails);

    const attributes: AudienceAttributes = {
      age,
      city: city.city,
      cityTier: city.tier,
      vipLevel,
      totalOrders: orders.totalOrders,
      lastActiveDaysAgo,
      purchaseCount30d,
      visitCount30d,
      preferredCategory,
      preferredChannel,
      optInSms: faker.number.float() < 0.82,
      optInEmail: faker.number.float() < 0.72,
      isBlacklisted: faker.number.float() < 0.015,
    };
    // 缺失字段直接不写入，而不是写 null/0；这样规则求值能区分“未填写”和真实零值。
    if (gender !== null) attributes.gender = gender;
    if (occupation !== null) attributes.occupation = occupation;
    if (interests !== null) attributes.interests = interests;
    if (orders.totalOrders > 0) {
      attributes.totalSpend = orders.totalSpend;
      attributes.avgOrderValue = orders.avgOrderValue;
      attributes.lastPurchaseDaysAgo = orders.lastPurchaseDaysAgo ?? 0;
    }

    users.push({
      id: faker.string.uuid(),
      externalId: `${DEMO_AUDIENCE_EXTERNAL_PREFIX}${String(index + 1).padStart(6, '0')}`,
      displayName,
      email,
      attributes,
    });
  }

  return users;
}
