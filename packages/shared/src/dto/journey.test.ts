import { describe, expect, it } from 'vitest';
import {
  journeyCreateSchema,
  journeyDetailSchema,
  journeyDraftSaveSchema,
  journeyListQuerySchema,
  journeyUpdateSchema,
} from './journey.js';

const segmentId = '00000000-0000-4000-8000-000000000001';

describe('旅程请求响应契约', () => {
  it('创建时规范化名称和说明，未提供分群按不绑定处理', () => {
    const parsed = journeyCreateSchema.parse({
      name: '  新客欢迎  ',
      description: '  ',
    });
    expect(parsed).toEqual({ name: '新客欢迎', description: null, segmentId: null });

    expect(journeyCreateSchema.parse({ name: '绑定分群', segmentId }).segmentId).toBe(segmentId);
    expect(journeyCreateSchema.parse({ name: '清空分群', segmentId: null }).segmentId).toBeNull();
  });

  it('创建时拒绝空名称、超长字段、非法分群和多余字段', () => {
    for (const payload of [
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(181) },
      { name: '有效名称', description: 'x'.repeat(4001) },
      { name: '有效名称', segmentId: 'not-a-uuid' },
      { name: '有效名称', segmentId: 123 },
      { name: '有效名称', campaignId: segmentId },
    ]) {
      expect(journeyCreateSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('修改时要求修订号和至少一个变更字段，null 表示清空', () => {
    expect(
      journeyUpdateSchema.parse({
        revision: 2,
        description: null,
        segmentId: null,
        name: '  改名  ',
      }),
    ).toEqual({ revision: 2, name: '改名', description: null, segmentId: null });

    expect(journeyUpdateSchema.parse({ revision: 1, segmentId }).segmentId).toBe(segmentId);
    expect(journeyUpdateSchema.safeParse({ revision: 1 }).success).toBe(false);
    expect(journeyUpdateSchema.safeParse({ revision: 0, name: '名称' }).success).toBe(false);
    expect(journeyUpdateSchema.safeParse({ name: '名称' }).success).toBe(false);
    expect(journeyUpdateSchema.safeParse({ revision: 1, name: '   ' }).success).toBe(false);
    expect(journeyUpdateSchema.safeParse({ revision: 1, name: '名称', extra: true }).success).toBe(
      false,
    );
    expect(journeyUpdateSchema.safeParse({ revision: 1, segmentId: 'not-a-uuid' }).success).toBe(
      false,
    );
  });

  it('列表查询默认第 1 页 10 条，搜索词限制 100 字', () => {
    expect(journeyListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 10 });
    expect(journeyListQuerySchema.parse({ q: '  欢迎  ' }).q).toBe('欢迎');
    expect(journeyListQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
    expect(journeyListQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(journeyListQuerySchema.safeParse({ pageSize: 5 }).success).toBe(false);
    expect(journeyListQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(journeyListQuerySchema.safeParse({ page: 1, pageSize: 10, extra: true }).success).toBe(
      false,
    );
  });

  it('旅程详情必须带草稿字段，null 表示还没有保存编排', () => {
    const detail = {
      id: segmentId,
      name: '欢迎旅程',
      description: null,
      revision: 1,
      campaign: { id: segmentId, name: '春季活动', status: 'draft' },
      segment: null,
      draftDefinition: null,
      createdAt: '2026-07-16T08:00:00.000Z',
      updatedAt: '2026-07-16T08:00:00.000Z',
      createdBy: { id: segmentId, displayName: '运营账号' },
      updatedBy: { id: segmentId, displayName: '运营账号' },
    };
    expect(journeyDetailSchema.parse(detail).draftDefinition).toBeNull();

    const draftDefinition = {
      layoutDirection: 'vertical' as const,
      nodes: [
        {
          id: 'n-start',
          type: 'start',
          name: '开始',
          position: { x: 0, y: 0 },
          entryBehavior: 'product_viewed',
        },
      ],
      edges: [],
    };
    expect(
      journeyDetailSchema.parse({ ...detail, draftDefinition }).draftDefinition?.nodes,
    ).toHaveLength(1);
    expect(journeyDetailSchema.safeParse({ ...detail, draftDefinition: undefined }).success).toBe(
      false,
    );
  });

  it('保存草稿必须带读取时的修订号和完整草稿定义', () => {
    const draftDefinition = {
      layoutDirection: 'vertical' as const,
      nodes: [
        {
          id: 'n-start',
          type: 'start',
          name: '开始',
          position: { x: 0, y: 0 },
          entryBehavior: 'product_viewed',
        },
      ],
      edges: [],
    };

    expect(journeyDraftSaveSchema.parse({ revision: 1, draftDefinition })).toEqual({
      revision: 1,
      draftDefinition,
    });
    expect(journeyDraftSaveSchema.safeParse({ draftDefinition }).success).toBe(false);
    expect(journeyDraftSaveSchema.safeParse({ revision: 0, draftDefinition }).success).toBe(false);
    expect(
      journeyDraftSaveSchema.safeParse({ revision: 1, draftDefinition, extra: true }).success,
    ).toBe(false);
    expect(
      journeyDraftSaveSchema.safeParse({ revision: 1, draftDefinition: { nodes: [], edges: [] } })
        .success,
    ).toBe(false);
  });
});
