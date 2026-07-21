import { z } from 'zod';
import { segmentRuleSchema } from '../segments/segment-rule.js';
import { campaignRefSchema } from './campaign.js';
import { JOURNEY_NAME_MAX_LENGTH } from './journey.js';
import { paginatedListSchema, paginationQuerySchema } from './pagination.js';

export const SEGMENT_NAME_MAX_LENGTH = 160;
export const SEGMENT_DESCRIPTION_MAX_LENGTH = 2000;
export const SEGMENT_SEARCH_MAX_LENGTH = 100;

export const SEGMENT_PREVIEW_LIMIT = 10_000;

const normalizedNameSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, '分群名称不能为空')
      .max(SEGMENT_NAME_MAX_LENGTH, `分群名称最多 ${SEGMENT_NAME_MAX_LENGTH} 个字符`),
  );

const optionalDescriptionSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .max(SEGMENT_DESCRIPTION_MAX_LENGTH, `分群说明最多 ${SEGMENT_DESCRIPTION_MAX_LENGTH} 个字符`),
  )
  .transform((value) => value || null)
  .nullable()
  .optional();

const createDescriptionSchema = optionalDescriptionSchema.transform((value) => value ?? null);

export const segmentCreateSchema = z
  .object({
    name: normalizedNameSchema,
    description: createDescriptionSchema,
    rules: segmentRuleSchema,
  })
  .strict();

// 修改必须带读取时的 revision；表单提交完整编辑值，但接口仍允许只改一个字段。
export const segmentUpdateSchema = z
  .object({
    revision: z.number().int().min(1, '修订号无效'),
    name: normalizedNameSchema.optional(),
    description: optionalDescriptionSchema,
    rules: segmentRuleSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined || value.description !== undefined || value.rules !== undefined,
    '请至少修改一项内容',
  );

export const segmentIdParamsSchema = z.object({ id: z.uuid() }).strict();

// 搜索词去掉首尾空格后为空就不加筛选；百分号和下划线的字面匹配在服务层处理。
export const segmentListQuerySchema = z
  .object({
    ...paginationQuerySchema.shape,
    q: z
      .string()
      .trim()
      .max(SEGMENT_SEARCH_MAX_LENGTH, `搜索词最多 ${SEGMENT_SEARCH_MAX_LENGTH} 个字符`)
      .transform((value) => value || undefined)
      .optional(),
  })
  .strict();

// 最近一次人数结果：revision 是计算时对应的分群修订号，isStale 由它与当前修订号比较得到。
export const segmentAudienceEstimateSchema = z
  .object({
    revision: z.number().int().min(1),
    total: z.number().int().min(0),
    matched: z.number().int().min(0),
    calculatedAt: z.iso.datetime(),
    isStale: z.boolean(),
  })
  .strict()
  .refine((value) => value.matched <= value.total, '命中人数不能超过受众总数');

// 列表返回完整规则而不是服务端摘要，前端用同一份规则生成摘要和编辑视图。
// journeyCount 用于在删除前判断是否仍被旅程引用，避免用户确认后才收到删除失败。
export const segmentListItemSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(SEGMENT_NAME_MAX_LENGTH),
    description: z.string().max(SEGMENT_DESCRIPTION_MAX_LENGTH).nullable(),
    rules: segmentRuleSchema,
    updatedAt: z.iso.datetime(),
    audienceEstimate: segmentAudienceEstimateSchema.nullable(),
    journeyCount: z.number().int().nonnegative(),
  })
  .strict();

const segmentAccountRefSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string().min(1).max(120),
  })
  .strict();

export const segmentDetailSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(SEGMENT_NAME_MAX_LENGTH),
    description: z.string().max(SEGMENT_DESCRIPTION_MAX_LENGTH).nullable(),
    rules: segmentRuleSchema,
    revision: z.number().int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    createdBy: segmentAccountRefSchema,
    updatedBy: segmentAccountRefSchema,
    audienceEstimate: segmentAudienceEstimateSchema.nullable(),
    journeyCount: z.number().int().nonnegative(),
  })
  .strict();

export const segmentListResponseSchema = paginatedListSchema(segmentListItemSchema);
export const segmentDetailResponseSchema = z.object({ data: segmentDetailSchema }).strict();

// 引用列表用于删除分群前确认影响范围：只显示旅程与所属活动，不复制分群规则。
export const segmentUsageItemSchema = z
  .object({
    journey: z
      .object({
        id: z.uuid(),
        name: z.string().min(1).max(JOURNEY_NAME_MAX_LENGTH),
      })
      .strict(),
    campaign: campaignRefSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const segmentUsageListResponseSchema = paginatedListSchema(segmentUsageItemSchema);

// 人数计算有两种互斥输入：未保存的规则只试算，已保存分群按当前修订号明确刷新。
export const segmentRulesPreviewRequestSchema = z.object({ rules: segmentRuleSchema }).strict();

export const segmentRefreshPreviewRequestSchema = z
  .object({
    segmentId: z.uuid(),
    revision: z.number().int().min(1),
  })
  .strict();

export const segmentPreviewRequestSchema = z.union([
  segmentRulesPreviewRequestSchema,
  segmentRefreshPreviewRequestSchema,
]);

const segmentPreviewFields = z
  .object({
    total: z.number().int().min(0),
    matched: z.number().int().min(0),
    calculatedAt: z.iso.datetime(),
  })
  .strict();

export const segmentPreviewSchema = segmentPreviewFields.refine(
  (value) => value.matched <= value.total,
  '命中人数不能超过受众总数',
);

// 刷新已保存分群后额外返回结果对应的修订号，客户端据此确认写入的是当前规则。
export const segmentRefreshPreviewSchema = segmentPreviewFields
  .extend({ revision: z.number().int().min(1) })
  .refine((value) => value.matched <= value.total, '命中人数不能超过受众总数');

export const segmentPreviewResponseSchema = z.object({ data: segmentPreviewSchema }).strict();
export const segmentRefreshPreviewResponseSchema = z
  .object({ data: segmentRefreshPreviewSchema })
  .strict();

export type SegmentCreate = z.output<typeof segmentCreateSchema>;
export type SegmentCreateInput = z.input<typeof segmentCreateSchema>;
export type SegmentUpdate = z.output<typeof segmentUpdateSchema>;
export type SegmentUpdateInput = z.input<typeof segmentUpdateSchema>;
export type SegmentListQuery = z.output<typeof segmentListQuerySchema>;
export type SegmentListQueryInput = z.input<typeof segmentListQuerySchema>;
export type SegmentListItem = z.infer<typeof segmentListItemSchema>;
export type SegmentDetail = z.infer<typeof segmentDetailSchema>;
export type SegmentUsageItem = z.infer<typeof segmentUsageItemSchema>;
export type SegmentAudienceEstimate = z.infer<typeof segmentAudienceEstimateSchema>;
export type SegmentPreview = z.infer<typeof segmentPreviewSchema>;
export type SegmentRefreshPreview = z.infer<typeof segmentRefreshPreviewSchema>;
export type SegmentRulesPreviewRequest = z.output<typeof segmentRulesPreviewRequestSchema>;
export type SegmentRefreshPreviewRequest = z.output<typeof segmentRefreshPreviewRequestSchema>;
export type SegmentPreviewRequest = z.output<typeof segmentPreviewRequestSchema>;
