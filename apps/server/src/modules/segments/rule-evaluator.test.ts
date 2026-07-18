import type {
  AudienceFieldKey,
  ComparisonOperator,
  JsonScalar,
  SegmentRule,
} from '@journeylens/shared';
import { describe, expect, it } from 'vitest';
import { evaluateSegmentRule, type SegmentAudienceInput } from './rule-evaluator.js';

const baseAttributes: Record<string, unknown> = {
  age: 28,
  gender: 'female',
  city: '上海',
  cityTier: 'tier1',
  occupation: 'office',
  vipLevel: 'gold',
  totalOrders: 8,
  totalSpend: 3999.6,
  avgOrderValue: 499.95,
  lastPurchaseDaysAgo: 6,
  lastActiveDaysAgo: 1,
  purchaseCount30d: 3,
  visitCount30d: 18,
  preferredCategory: 'electronics',
  preferredChannel: 'app',
  interests: ['数码', '游戏'],
  optInSms: true,
  optInEmail: true,
  isBlacklisted: false,
};

const user: SegmentAudienceInput = {
  displayName: '林小满',
  email: 'lin@example.com',
  attributes: baseAttributes,
};

const noGender: SegmentAudienceInput = {
  displayName: '吴念',
  email: null,
  attributes: { age: 39, totalOrders: 0, isBlacklisted: true },
};

function compare(
  path: AudienceFieldKey,
  operator: ComparisonOperator,
  right?: JsonScalar | JsonScalar[],
): SegmentRule {
  return {
    kind: 'compare',
    left: { source: 'user', path },
    operator,
    ...(right === undefined ? {} : { right }),
  };
}

function evaluate(rule: SegmentRule, input: SegmentAudienceInput = user): boolean {
  return evaluateSegmentRule(rule, input);
}

describe('分群规则求值', () => {
  it('组合且、或、非', () => {
    const rule: SegmentRule = {
      kind: 'all',
      children: [
        compare('vipLevel', 'in', ['gold', 'platinum']),
        {
          kind: 'any',
          children: [compare('cityTier', 'in', ['tier2']), compare('age', 'lt', 30)],
        },
        { kind: 'not', child: compare('isBlacklisted', 'eq', true) },
      ],
    };
    expect(evaluate(rule)).toBe(true);

    expect(
      evaluate({ kind: 'all', children: [compare('age', 'gt', 30), compare('age', 'lt', 20)] }),
    ).toBe(false);
    expect(
      evaluate({ kind: 'any', children: [compare('age', 'gt', 30), compare('age', 'lt', 20)] }),
    ).toBe(false);
    expect(evaluate({ kind: 'not', child: compare('age', 'gt', 30) })).toBe(true);
  });

  it('严格比较类型，不把数字或布尔文本转换成对应类型', () => {
    expect(evaluate(compare('totalOrders', 'eq', '8'))).toBe(false);
    expect(evaluate(compare('totalOrders', 'neq', '8'))).toBe(false);
    expect(evaluate(compare('optInSms', 'eq', 'true'))).toBe(false);
    expect(evaluate(compare('age', 'gte', '18'))).toBe(false);
    expect(evaluate(compare('totalOrders', 'eq', 8))).toBe(true);
    expect(evaluate(compare('optInSms', 'eq', true))).toBe(true);
  });

  it('缺失属性对普通比较不命中，外层“非”再取反', () => {
    for (const rule of [
      compare('gender', 'in', ['female']),
      compare('gender', 'not_in', ['male']),
      compare('gender', 'exists'),
    ]) {
      expect(evaluate(rule, noGender)).toBe(false);
    }

    expect(evaluate({ kind: 'not', child: compare('gender', 'in', ['female']) }, noGender)).toBe(
      true,
    );
    expect(evaluate({ kind: 'not', child: compare('gender', 'in', ['male']) }, noGender)).toBe(
      true,
    );
  });

  it('“不等于”与“排除等于”对缺失属性的结果不同', () => {
    expect(evaluate(compare('gender', 'not_in', ['male']), noGender)).toBe(false);
    expect(evaluate({ kind: 'not', child: compare('gender', 'in', ['male']) }, noGender)).toBe(
      true,
    );
  });

  it('显式 undefined 与缺失值相同，不读取继承的属性', () => {
    const inherited = Object.create({ gender: 'female' }) as Record<string, unknown>;
    for (const attributes of [{ gender: undefined }, inherited]) {
      const input: SegmentAudienceInput = { ...user, attributes };
      expect(evaluate(compare('gender', 'exists'), input)).toBe(false);
      expect(evaluate(compare('gender', 'not_in', ['male']), input)).toBe(false);
      expect(evaluate({ kind: 'not', child: compare('gender', 'exists') }, input)).toBe(true);
    }
  });

  it('邮箱和属性字段都用 exists 判断未填写，0 和 false 不当作未填写', () => {
    expect(evaluate(compare('email', 'exists'), user)).toBe(true);
    expect(evaluate(compare('email', 'exists'), noGender)).toBe(false);
    expect(evaluate({ kind: 'not', child: compare('email', 'exists') }, noGender)).toBe(true);
    expect(evaluate(compare('displayName', 'exists'), noGender)).toBe(true);
    expect(evaluate(compare('email', 'eq', 'lin@example.com'), noGender)).toBe(false);
    expect(evaluate(compare('email', 'contains', 'example'), noGender)).toBe(false);

    expect(evaluate(compare('totalOrders', 'eq', 0), noGender)).toBe(true);
    expect(evaluate(compare('isBlacklisted', 'eq', true), noGender)).toBe(true);
    expect(evaluate(compare('optInSms', 'eq', false), user)).toBe(false);
    expect(evaluate(compare('isBlacklisted', 'eq', false), user)).toBe(true);

    const notSubscribed: SegmentAudienceInput = {
      ...user,
      attributes: { ...baseAttributes, optInSms: false, isBlacklisted: false },
    };
    expect(evaluate(compare('optInSms', 'eq', false), notSubscribed)).toBe(true);
    expect(evaluate(compare('isBlacklisted', 'eq', false), notSubscribed)).toBe(true);
  });

  it('数字比较覆盖等于、不等于和边界', () => {
    expect(evaluate(compare('age', 'eq', 28))).toBe(true);
    expect(evaluate(compare('age', 'neq', 28))).toBe(false);
    expect(evaluate(compare('age', 'gt', 27))).toBe(true);
    expect(evaluate(compare('age', 'gt', 28))).toBe(false);
    expect(evaluate(compare('age', 'gte', 28))).toBe(true);
    expect(evaluate(compare('age', 'lt', 29))).toBe(true);
    expect(evaluate(compare('age', 'lte', 28))).toBe(true);
    expect(evaluate(compare('totalSpend', 'gte', 3999.6))).toBe(true);
    expect(evaluate(compare('totalSpend', 'gt', 3999.6))).toBe(false);
  });

  it('枚举多选使用属于和不属于', () => {
    expect(evaluate(compare('vipLevel', 'in', ['silver', 'gold']))).toBe(true);
    expect(evaluate(compare('vipLevel', 'not_in', ['silver', 'gold']))).toBe(false);
    expect(evaluate(compare('city', 'in', ['北京', '上海']))).toBe(true);
    expect(evaluate(compare('city', 'in', ['北京']))).toBe(false);
  });

  it('昵称和邮箱文本比较保持大小写语义', () => {
    expect(evaluate(compare('displayName', 'eq', '林小满'))).toBe(true);
    expect(evaluate(compare('displayName', 'eq', '林小桃'))).toBe(false);
    expect(evaluate(compare('email', 'contains', 'lin@'))).toBe(true);
    expect(evaluate(compare('email', 'contains', 'LIN@'))).toBe(false);
  });

  it('兴趣标签按数组包含单个标签', () => {
    expect(evaluate(compare('interests', 'contains', '数码'))).toBe(true);
    expect(evaluate(compare('interests', 'contains', '护肤'))).toBe(false);
    expect(
      evaluate(compare('interests', 'contains', '护肤'), {
        ...user,
        attributes: { ...baseAttributes, interests: [] },
      }),
    ).toBe(false);
    expect(
      evaluate({ kind: 'not', child: compare('interests', 'contains', '数码') }, noGender),
    ).toBe(true);
  });

  it('兴趣数组含非标量值时，不能因存在匹配标签就命中', () => {
    const input: SegmentAudienceInput = {
      ...user,
      attributes: { ...baseAttributes, interests: ['数码', {}] },
    };
    expect(evaluate(compare('interests', 'contains', '数码'), input)).toBe(false);
    expect(evaluate({ kind: 'not', child: compare('interests', 'contains', '数码') }, input)).toBe(
      true,
    );
  });

  it('存在条件把 null 和缺失都视为未填写', () => {
    const withNullGender: SegmentAudienceInput = {
      ...user,
      attributes: { ...baseAttributes, gender: null },
    };
    expect(evaluate(compare('gender', 'exists'), user)).toBe(true);
    expect(evaluate(compare('gender', 'exists'), withNullGender)).toBe(false);
    expect(evaluate({ kind: 'not', child: compare('gender', 'exists') }, withNullGender)).toBe(
      true,
    );
  });

  it('null 值使数字区间比较为假，取反后为真', () => {
    const withNullAge: SegmentAudienceInput = {
      ...user,
      attributes: { ...baseAttributes, age: null },
    };
    expect(evaluate(compare('age', 'gt', 10), withNullAge)).toBe(false);
    expect(evaluate(compare('age', 'lte', 10), withNullAge)).toBe(false);
    expect(evaluate({ kind: 'not', child: compare('age', 'gt', 10) }, withNullAge)).toBe(true);
    expect(evaluate({ kind: 'not', child: compare('age', 'lte', 10) }, withNullAge)).toBe(true);
    expect(evaluate(compare('age', 'neq', 5), withNullAge)).toBe(true);
  });

  it('类型不符或值缺失时不命中', () => {
    const broken: SegmentAudienceInput = {
      ...user,
      attributes: { ...baseAttributes, age: '28', interests: 123 },
    };
    expect(evaluate(compare('age', 'gte', 18), broken)).toBe(false);
    expect(evaluate(compare('interests', 'contains', '数码'), broken)).toBe(false);
    expect(evaluate(compare('age', 'gte', 18), { ...user, attributes: null })).toBe(false);
  });
});
