import { describe, expect, it } from 'vitest';
import { journeyConditionRuleSchema, waitForEventConfigSchema } from './journey-condition.js';
import { journeyEventOperators } from './journey-events.js';

const categoryCompare = {
  kind: 'compare',
  left: { source: 'entry_event', eventType: 'product_viewed', path: 'category' },
  operator: 'eq',
  right: 'electronics',
};

describe('行为属性比较规则', () => {
  it('行为类目使用单值比较，用户偏好类目仍支持多选比较', () => {
    expect(journeyEventOperators('product_viewed', 'category')).toEqual(['eq', 'neq', 'exists']);
    expect(journeyConditionRuleSchema.safeParse(categoryCompare).success).toBe(true);
    const invalid = journeyConditionRuleSchema.safeParse({
      ...categoryCompare,
      operator: 'in',
      right: ['electronics'],
    });
    expect(invalid.success).toBe(false);
    if (invalid.success) return;
    expect(invalid.error.issues).toContainEqual(
      expect.objectContaining({
        path: ['right'],
        message: '行为属性只能填写单个比较值，不能填写多个值',
      }),
    );
    expect(
      journeyConditionRuleSchema.safeParse({
        kind: 'compare',
        left: { source: 'user', path: 'preferredCategory' },
        operator: 'in',
        right: ['electronics'],
      }).success,
    ).toBe(true);
  });

  it('行为等待和次数筛选沿用行为类目的单值规则', () => {
    for (const filter of [
      { path: 'category', operator: 'eq', right: 'electronics' },
      { path: 'category', operator: 'in', right: ['electronics'] },
    ]) {
      const expected = filter.operator === 'eq';
      expect(
        waitForEventConfigSchema.safeParse({
          eventType: 'product_viewed',
          waitSeconds: 3600,
          sameProduct: true,
          filter,
        }).success,
      ).toBe(expected);
      expect(
        journeyConditionRuleSchema.safeParse({
          kind: 'event_count',
          eventType: 'product_viewed',
          windowSeconds: 3600,
          sameProduct: true,
          operator: 'gte',
          right: 1,
          filter,
        }).success,
      ).toBe(expected);
    }
  });

  it('数字、普通文本和已填写比较保留各自的合法范围', () => {
    expect(journeyEventOperators('product_viewed', 'price')).toContain('gte');
    expect(journeyEventOperators('product_viewed', 'productName')).toContain('contains');
    expect(
      journeyConditionRuleSchema.safeParse({
        ...categoryCompare,
        left: { ...categoryCompare.left, path: 'price' },
        operator: 'gte',
        right: 2000,
      }).success,
    ).toBe(true);
    expect(
      journeyConditionRuleSchema.safeParse({
        ...categoryCompare,
        left: { ...categoryCompare.left, path: 'productName' },
        operator: 'contains',
        right: '耳机',
      }).success,
    ).toBe(true);
    expect(
      journeyConditionRuleSchema.safeParse({
        kind: 'compare',
        left: categoryCompare.left,
        operator: 'exists',
      }).success,
    ).toBe(true);
    expect(
      journeyConditionRuleSchema.safeParse({ ...categoryCompare, operator: 'exists' }).success,
    ).toBe(false);
  });
});
