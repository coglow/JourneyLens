import { z } from 'zod';
import { segmentRuleSchema } from '../segments/segment-rule.js';
import { campaignRefSchema } from './campaign.js';
import { paginatedListSchema, paginationQuerySchema } from './pagination.js';

export const JOURNEY_NAME_MAX_LENGTH = 180;
export const JOURNEY_DESCRIPTION_MAX_LENGTH = 4000;
export const JOURNEY_SEARCH_MAX_LENGTH = 100;

const normalizedNameSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, '旅程名称不能为空')
      .max(JOURNEY_NAME_MAX_LENGTH, `旅程名称最多 ${JOURNEY_NAME_MAX_LENGTH} 个字符`),
  );

// 说明去掉首尾空格后为空就按“没有说明”保存，不区分空白和未填写。
const optionalDescriptionSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .max(JOURNEY_DESCRIPTION_MAX_LENGTH, `旅程说明最多 ${JOURNEY_DESCRIPTION_MAX_LENGTH} 个字符`),
  )
  .transform((value) => value || null)
  .nullable()
  .optional();

const createDescriptionSchema = optionalDescriptionSchema.transform((value) => value ?? null);

// 修改时 undefined 表示保持原值，null 表示解除绑定，值表示更换入口分群。
const optionalSegmentIdSchema = z.uuid().nullable().optional();

export const journeyCreateSchema = z
  .object({
    name: normalizedNameSchema,
    description: createDescriptionSchema,
    // 不传或显式 null 都表示不绑定入口分群。
    segmentId: optionalSegmentIdSchema.transform((value) => value ?? null),
  })
  .strict();

// 修改必须带读取时的 revision；表单提交完整编辑值，但接口仍允许只改一个字段。
export const journeyUpdateSchema = z
  .object({
    revision: z.number().int().min(1, '修订号无效'),
    name: normalizedNameSchema.optional(),
    description: optionalDescriptionSchema,
    segmentId: optionalSegmentIdSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined || value.description !== undefined || value.segmentId !== undefined,
    '请至少修改一项内容',
  );

export const journeyIdParamsSchema = z.object({ id: z.uuid() }).strict();
export const campaignJourneyParamsSchema = z.object({ campaignId: z.uuid() }).strict();

// 搜索词去掉首尾空格后为空就不加筛选；百分号和下划线的字面匹配在服务层处理。
export const journeyListQuerySchema = z
  .object({
    ...paginationQuerySchema.shape,
    q: z
      .string()
      .trim()
      .max(JOURNEY_SEARCH_MAX_LENGTH, `搜索词最多 ${JOURNEY_SEARCH_MAX_LENGTH} 个字符`)
      .transform((value) => value || undefined)
      .optional(),
  })
  .strict();

const journeyAccountRefSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string().min(1).max(120),
  })
  .strict();

// 详情返回当前分群及其规则，不保存规则副本；修改分群后重新读取即可看到最新内容。
export const journeySegmentRefSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(160),
    revision: z.number().int().min(1),
    rules: segmentRuleSchema,
  })
  .strict();

const journeySegmentSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(160),
  })
  .strict();

export const journeyListItemSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(JOURNEY_NAME_MAX_LENGTH),
    description: z.string().max(JOURNEY_DESCRIPTION_MAX_LENGTH).nullable(),
    segment: journeySegmentSummarySchema.nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const journeyDetailSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(JOURNEY_NAME_MAX_LENGTH),
    description: z.string().max(JOURNEY_DESCRIPTION_MAX_LENGTH).nullable(),
    revision: z.number().int().min(1),
    campaign: campaignRefSchema,
    segment: journeySegmentRefSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    createdBy: journeyAccountRefSchema,
    updatedBy: journeyAccountRefSchema,
  })
  .strict();

export const journeyListResponseSchema = paginatedListSchema(journeyListItemSchema);
export const journeyDetailResponseSchema = z.object({ data: journeyDetailSchema }).strict();

export type JourneyCreate = z.output<typeof journeyCreateSchema>;
export type JourneyCreateInput = z.input<typeof journeyCreateSchema>;
export type JourneyUpdate = z.output<typeof journeyUpdateSchema>;
export type JourneyUpdateInput = z.input<typeof journeyUpdateSchema>;
export type JourneyListQuery = z.output<typeof journeyListQuerySchema>;
export type JourneyListQueryInput = z.input<typeof journeyListQuerySchema>;
export type JourneyListItem = z.infer<typeof journeyListItemSchema>;
export type JourneyDetail = z.infer<typeof journeyDetailSchema>;
