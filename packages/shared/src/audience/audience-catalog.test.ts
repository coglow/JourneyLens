import { describe, expect, it } from 'vitest';
import {
  AUDIENCE_FIELD_KEYS,
  AUDIENCE_FIELDS,
  COMPARISON_OPERATORS,
  audienceField,
  type AudienceFieldKey,
} from './audience-catalog.js';

/**
 * 业务字段范围的独立断言：手写期望值，不从字段表里取数据，
 * 这样字段被误删、改名或调整顺序时测试仍能发现。
 */
const EXPECTED_FIELD_KEYS = [
  'displayName',
  'email',
  'age',
  'gender',
  'city',
  'cityTier',
  'occupation',
  'vipLevel',
  'totalOrders',
  'totalSpend',
  'avgOrderValue',
  'lastPurchaseDaysAgo',
  'lastActiveDaysAgo',
  'purchaseCount30d',
  'visitCount30d',
  'preferredCategory',
  'preferredChannel',
  'interests',
  'optInSms',
  'optInEmail',
  'isBlacklisted',
] as const;

describe('用户属性目录', () => {
  it('包含 21 个业务字段，字段键与顺序符合预期', () => {
    expect(AUDIENCE_FIELDS).toHaveLength(21);
    expect(AUDIENCE_FIELD_KEYS).toEqual(EXPECTED_FIELD_KEYS);
  });

  it('字段键保持精确联合类型，目录外的键无法赋值', () => {
    const known: AudienceFieldKey = 'vipLevel';
    expect(known).toBe('vipLevel');

    // @ts-expect-error 目录外字段不是合法字段键；联合退化为 string 时本行会失去报错。
    const unknown: AudienceFieldKey = 'unknown';
    expect(unknown).toBe('unknown');
  });

  it('每个字段都声明了目录内比较方式和必要约束', () => {
    for (const field of AUDIENCE_FIELDS) {
      expect(field.label.length).toBeGreaterThan(0);
      expect(field.operators.length).toBeGreaterThan(0);
      for (const operator of field.operators) {
        expect(COMPARISON_OPERATORS).toContain(operator);
      }
      if (field.kind === 'number') {
        expect(field.minimum).toBe(0);
        expect([0, 2]).toContain(field.precision);
      }
      // 只有枚举类字段声明可选值，因此用 in 收窄字面量联合。
      if ('values' in field) {
        expect(field.values.length).toBeGreaterThan(0);
      }
    }
  });

  it('只通过字段键读取目录，未知键返回 undefined', () => {
    expect(audienceField('vipLevel')?.label).toBe('会员等级');
    expect(audienceField('unknown')).toBeUndefined();
  });

  it('所有字段都用 exists 判断已填写，不再声明按字段区分的未填写写法', () => {
    for (const field of AUDIENCE_FIELDS) {
      expect(field.operators).toContain('exists');
      expect(field).not.toHaveProperty('unfilled');
    }
  });
});
