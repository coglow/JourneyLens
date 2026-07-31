import { z } from 'zod';
import { paginatedListSchema, paginationQuerySchema } from './pagination.js';

export const CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'running',
  'paused',
  'ended',
  'stopped',
] as const;

const normalizedNameSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(180));

const normalizedDescriptionSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().max(4000))
  .transform((value) => value || null)
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const normalizedOptionalDescriptionSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().max(4000))
  .transform((value) => value || null)
  .nullable()
  .optional();

export const campaignBudgetSchema = z
  .object({ amount: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/) })
  .strict();

export const campaignCreateSchema = z
  .object({
    name: normalizedNameSchema,
    description: normalizedDescriptionSchema,
    budget: campaignBudgetSchema.nullable().optional(),
  })
  .strict();

export const campaignUpdateSchema = z
  .object({
    name: normalizedNameSchema.optional(),
    description: normalizedOptionalDescriptionSchema,
    budget: campaignBudgetSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined));

export const campaignIdParamsSchema = z.object({ id: z.uuid() }).strict();

/** 状态操作没有业务参数：正文必须是空对象，携带状态等字段一律拒绝。 */
export const campaignTransitionBodySchema = z.object({}).strict();

export const campaignStatusSchema = z.enum(CAMPAIGN_STATUSES);

/**
 * 活动资料与旅程维护开放的状态：草稿和暂停是配置维护窗口。
 * 后端把同一常量用作写入条件，前后端判断不会各自漂移。
 */
export const EDITABLE_CAMPAIGN_STATUSES = ['draft', 'paused'] as const;

/**
 * 活动资料与旅程维护是否开放：只有草稿和暂停是配置维护窗口。
 * 启动、暂停、恢复、停止本身，以及活动删除、已发布版本删除仍各自判断，不能只看这个条件。
 */
export function canEditCampaign(status: CampaignStatus): boolean {
  return (EDITABLE_CAMPAIGN_STATUSES as readonly CampaignStatus[]).includes(status);
}

export const campaignListQuerySchema = z
  .object({
    ...paginationQuerySchema.shape,
    q: z
      .string()
      .trim()
      .max(180)
      .transform((value) => value || undefined)
      .optional(),
    status: campaignStatusSchema.optional(),
  })
  .strict();

const campaignDescriptionSchema = z.string().min(1).max(4000).nullable();

const campaignAccountRefSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string().min(1).max(120),
  })
  .strict();

// 旅程详情和分群引用列表共用的活动引用，统一由活动模块定义。
export const campaignRefSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(180),
    status: campaignStatusSchema,
  })
  .strict();

const campaignBaseSchema = campaignRefSchema.extend({ updatedAt: z.iso.datetime() }).strict();

// 列表直接带说明、预算和创建人，页面按列展示时无需为每行再读详情。
const campaignListItemSchema = campaignBaseSchema
  .extend({
    description: campaignDescriptionSchema,
    budget: campaignBudgetSchema.nullable(),
    createdBy: campaignAccountRefSchema,
    journeyCount: z.number().int().nonnegative(),
  })
  .strict();

export const campaignDetailSchema = campaignBaseSchema
  .extend({
    description: campaignDescriptionSchema,
    budget: campaignBudgetSchema.nullable(),
    createdAt: z.iso.datetime(),
    createdBy: campaignAccountRefSchema,
  })
  .strict();

export const campaignListResponseSchema = paginatedListSchema(campaignListItemSchema);

export const campaignDetailResponseSchema = z.object({ data: campaignDetailSchema }).strict();

const campaignOverviewStatusCountsSchema = z
  .object({
    running: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    stopped: z.number().int().nonnegative(),
  })
  .strict();

export const campaignOverviewResponseSchema = z
  .object({
    data: z
      .object({
        campaignId: z.uuid(),
        executionCount: z.number().int().nonnegative(),
        audienceCount: z.number().int().nonnegative(),
        statusCounts: campaignOverviewStatusCountsSchema,
      })
      .strict(),
  })
  .strict();

export type CampaignCreate = z.output<typeof campaignCreateSchema>;
export type CampaignCreateInput = z.input<typeof campaignCreateSchema>;
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;
export type CampaignBudget = z.infer<typeof campaignBudgetSchema>;
export type CampaignUpdate = z.output<typeof campaignUpdateSchema>;
export type CampaignUpdateInput = z.input<typeof campaignUpdateSchema>;
export type CampaignListQuery = z.output<typeof campaignListQuerySchema>;
export type CampaignListQueryInput = z.input<typeof campaignListQuerySchema>;
export type CampaignListItem = z.infer<typeof campaignListItemSchema>;
export type CampaignDetail = z.infer<typeof campaignDetailSchema>;
export type CampaignOverview = z.infer<typeof campaignOverviewResponseSchema>['data'];
