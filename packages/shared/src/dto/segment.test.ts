import { describe, expect, it } from 'vitest';
import {
  segmentAudienceEstimateSchema,
  segmentCreateSchema,
  segmentListQuerySchema,
  segmentPreviewRequestSchema,
  segmentUpdateSchema,
  segmentUsageListResponseSchema,
} from './segment.js';

const compare = {
  kind: 'compare',
  left: { source: 'user', path: 'age' },
  operator: 'gte',
  right: 18,
} as const;

describe('分群请求响应契约', () => {
  it.each([
    ['创建', (rules: unknown) => segmentCreateSchema.safeParse({ name: '六层条件', rules })],
    ['修改', (rules: unknown) => segmentUpdateSchema.safeParse({ revision: 1, rules })],
    ['预估', (rules: unknown) => segmentPreviewRequestSchema.safeParse({ rules })],
  ] as const)('%s接受六层规则并拒绝七层规则', (_action, parse) => {
    let rules: unknown = compare;
    for (let level = 1; level < 6; level += 1) {
      rules = { kind: 'all', children: [rules] };
    }

    expect(parse(rules).success).toBe(true);
    expect(parse({ kind: 'all', children: [rules] }).success).toBe(false);
  });

  it('创建时规范化名称和说明并拒绝多余字段', () => {
    const parsed = segmentCreateSchema.parse({
      name: '  高价值会员  ',
      description: '   ',
      rules: compare,
    });
    expect(parsed.name).toBe('高价值会员');
    expect(parsed.description).toBeNull();

    expect(
      segmentCreateSchema.safeParse({ name: '  ', description: null, rules: compare }).success,
    ).toBe(false);
    expect(
      segmentCreateSchema.safeParse({
        name: 'x'.repeat(161),
        description: null,
        rules: compare,
      }).success,
    ).toBe(false);
    expect(
      segmentCreateSchema.safeParse({
        name: '合法名称',
        description: 'x'.repeat(2001),
        rules: compare,
      }).success,
    ).toBe(false);
    expect(
      segmentCreateSchema.safeParse({ name: '合法名称', rules: compare, extra: true }).success,
    ).toBe(false);
  });

  it('修改时要求修订号和至少一个变更字段', () => {
    const parsed = segmentUpdateSchema.parse({
      revision: 2,
      name: '  新名称  ',
      description: '  ',
    });
    expect(parsed).toEqual({ revision: 2, name: '新名称', description: null });

    expect(segmentUpdateSchema.safeParse({ revision: 1 }).success).toBe(false);
    expect(segmentUpdateSchema.safeParse({ revision: 0, name: '名称' }).success).toBe(false);
    expect(segmentUpdateSchema.safeParse({ name: '名称' }).success).toBe(false);
  });

  it('列表查询默认第 1 页 10 条，搜索词限制 100 字', () => {
    expect(segmentListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 10 });
    expect(segmentListQuerySchema.parse({ q: '  会员  ' }).q).toBe('会员');
    expect(segmentListQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
    expect(segmentListQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(segmentListQuerySchema.safeParse({ pageSize: 5 }).success).toBe(false);
  });

  it('人数计算接受规则试算或已保存分群刷新两种互斥输入', () => {
    const segmentId = '00000000-0000-4000-8000-000000000001';

    expect(segmentPreviewRequestSchema.safeParse({ rules: compare }).success).toBe(true);
    expect(segmentPreviewRequestSchema.safeParse({ segmentId, revision: 1 }).success).toBe(true);

    for (const payload of [
      { rules: compare, segmentId },
      { rules: compare, segmentId, revision: 1 },
      { rules: compare, revision: 1 },
      { segmentId, revision: 0 },
      { segmentId, revision: 1.5 },
      { segmentId: 'not-a-uuid', revision: 1 },
      { segmentId },
      { revision: 1 },
    ]) {
      expect(segmentPreviewRequestSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('最近人数结果包含修订号、人数、计算时间和过期状态', () => {
    const estimate = {
      revision: 2,
      total: 2000,
      matched: 121,
      calculatedAt: '2026-07-18T08:00:00.000Z',
      isStale: false,
    };

    expect(segmentAudienceEstimateSchema.safeParse(estimate).success).toBe(true);
    expect(segmentAudienceEstimateSchema.safeParse({ ...estimate, matched: 2001 }).success).toBe(
      false,
    );
    expect(segmentAudienceEstimateSchema.safeParse({ ...estimate, revision: 0 }).success).toBe(
      false,
    );
    expect(segmentAudienceEstimateSchema.safeParse({ ...estimate, extra: true }).success).toBe(
      false,
    );
  });

  it('分群引用列表返回旅程、所属活动和分页信息', () => {
    const usage = {
      journey: {
        id: '00000000-0000-4000-8000-000000000011',
        name: '新客欢迎旅程',
      },
      campaign: {
        id: '00000000-0000-4000-8000-000000000012',
        name: '春季活动',
        status: 'draft',
      },
      updatedAt: '2026-07-19T08:00:00.000Z',
    };
    const response = {
      data: [usage],
      page: { page: 1, pageSize: 10, total: 1 },
    };

    expect(segmentUsageListResponseSchema.safeParse(response).success).toBe(true);
    expect(
      segmentUsageListResponseSchema.safeParse({
        ...response,
        data: [{ ...usage, rules: compare }],
      }).success,
    ).toBe(false);
    expect(
      segmentUsageListResponseSchema.safeParse({
        ...response,
        data: [{ ...usage, campaign: { ...usage.campaign, status: '未知' } }],
      }).success,
    ).toBe(false);
  });
});
