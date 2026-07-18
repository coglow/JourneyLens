import { audienceField } from '@journeylens/shared';
import { describe, expect, it } from 'vitest';
import { DEMO_AUDIENCE_COUNT, generateDemoAudience } from './seed-audience-generator.js';

const users = generateDemoAudience();

/** 目录声明的可选值，用来核对生成结果没有超出共享枚举。 */
function catalogValues(fieldKey: string): Set<string> {
  const field = audienceField(fieldKey);
  if (field?.values === undefined) throw new Error(`属性目录缺少 ${fieldKey} 的可选值`);
  return new Set(field.values.map((item) => item.value));
}

/** 读取数字属性；类型不符时直接抛错，避免用类型断言掩盖问题。 */
function numberValue(value: unknown): number {
  if (typeof value !== 'number') throw new Error(`期望数字属性，实际为 ${String(value)}`);
  return value;
}

describe('演示受众生成器', () => {
  it('固定种子生成 2,000 名可重复且标识唯一的受众', () => {
    expect(users).toHaveLength(DEMO_AUDIENCE_COUNT);
    expect(generateDemoAudience()).toEqual(users);

    expect(new Set(users.map((user) => user.id)).size).toBe(DEMO_AUDIENCE_COUNT);
    expect(new Set(users.map((user) => user.displayName)).size).toBe(DEMO_AUDIENCE_COUNT);
    const emails = users.flatMap((user) => (user.email === null ? [] : [user.email]));
    expect(emails.length).toBeGreaterThan(0);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('枚举字段只使用共享目录声明的取值', () => {
    const allowed = {
      gender: catalogValues('gender'),
      occupation: catalogValues('occupation'),
      city: catalogValues('city'),
      cityTier: catalogValues('cityTier'),
      vipLevel: catalogValues('vipLevel'),
      preferredCategory: catalogValues('preferredCategory'),
      preferredChannel: catalogValues('preferredChannel'),
      interests: catalogValues('interests'),
    };

    const invalid: string[] = [];
    for (const { attributes } of users) {
      for (const key of ['gender', 'occupation', 'city', 'cityTier', 'vipLevel'] as const) {
        const value = attributes[key];
        if (value !== undefined && !allowed[key].has(String(value))) {
          invalid.push(`${key}=${String(value)}`);
        }
      }
      for (const key of ['preferredCategory', 'preferredChannel'] as const) {
        if (!allowed[key].has(String(attributes[key]))) {
          invalid.push(`${key}=${String(attributes[key])}`);
        }
      }
      if (Array.isArray(attributes.interests)) {
        for (const tag of attributes.interests) {
          if (!allowed.interests.has(String(tag))) invalid.push(`interest=${String(tag)}`);
        }
      }
    }

    expect(invalid).toEqual([]);
  });

  it('城市与层级、类目与兴趣、年龄与职业保持既定关联', () => {
    const cityTiers: Record<string, string> = {
      上海: 'tier1',
      北京: 'tier1',
      深圳: 'tier1',
      杭州: 'tier1',
      广州: 'tier1',
      成都: 'tier2',
      武汉: 'tier2',
      南京: 'tier2',
      重庆: 'tier2',
      西安: 'tier2',
      苏州: 'tier2',
      郑州: 'tier3',
    };
    const interestPools: Record<string, readonly string[]> = {
      electronics: ['数码', '游戏', '智能家居'],
      beauty: ['护肤', '彩妆', '香氛'],
      fashion: ['穿搭', '潮流', '运动'],
      home: ['家居', '收纳', '香薰'],
      food: ['美食', '咖啡', '零食'],
      digital: ['会员', '云服务', '效率工具'],
    };

    const invalid: string[] = [];
    for (const { attributes } of users) {
      const city = String(attributes.city);
      if (attributes.cityTier !== cityTiers[city]) {
        invalid.push(`城市 ${city} 的层级为 ${String(attributes.cityTier)}`);
      }

      const pool = interestPools[String(attributes.preferredCategory)];
      if (pool === undefined) {
        invalid.push(`类目 ${String(attributes.preferredCategory)} 没有兴趣标签池`);
      } else if (Array.isArray(attributes.interests)) {
        for (const tag of attributes.interests) {
          if (!pool.includes(String(tag)))
            invalid.push(`${String(attributes.preferredCategory)} 出现标签 ${tag}`);
        }
      }

      const age = numberValue(attributes.age);
      if (attributes.occupation === 'student' && age > 45) invalid.push(`学生年龄 ${age}`);
      if (attributes.occupation === 'retired' && age <= 25) invalid.push(`退休年龄 ${age}`);
    }

    expect(invalid).toEqual([]);
  });

  it('订单、消费和购买时间自洽，未填写字段不写入属性对象', () => {
    for (const { attributes } of users) {
      const totalOrders = numberValue(attributes.totalOrders);
      if (totalOrders === 0) {
        expect(attributes.totalSpend).toBeUndefined();
        expect(attributes.avgOrderValue).toBeUndefined();
        expect(attributes.lastPurchaseDaysAgo).toBeUndefined();
        continue;
      }

      const totalSpend = numberValue(attributes.totalSpend);
      const lastPurchaseDaysAgo = numberValue(attributes.lastPurchaseDaysAgo);
      const purchaseCount30d = numberValue(attributes.purchaseCount30d);
      expect(totalSpend).toBeGreaterThan(0);
      expect(numberValue(attributes.avgOrderValue)).toBe(
        Math.round((totalSpend / totalOrders) * 100) / 100,
      );
      expect(lastPurchaseDaysAgo).toBeGreaterThanOrEqual(0);
      expect(numberValue(attributes.lastActiveDaysAgo)).toBeLessThanOrEqual(lastPurchaseDaysAgo);
      expect(purchaseCount30d).toBeLessThanOrEqual(Math.min(totalOrders, 8));
      expect(purchaseCount30d > 0).toBe(lastPurchaseDaysAgo <= 30);
    }

    for (const key of ['gender', 'occupation', 'interests'] as const) {
      const missing = users.filter((user) => user.attributes[key] === undefined);
      expect(missing.length).toBeGreaterThan(0);
      expect(missing.every((user) => !Object.hasOwn(user.attributes, key))).toBe(true);
    }
  });
});
