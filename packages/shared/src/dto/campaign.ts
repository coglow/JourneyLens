import { z } from 'zod';
import { paginatedListSchema, paginationQuerySchema } from './pagination.js';

export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'running', 'ended', 'stopped'] as const;

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

export const campaignStatusSchema = z.enum(CAMPAIGN_STATUSES);

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

export const campaignSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(180),
    status: campaignStatusSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const campaignDetailSchema = campaignSummarySchema
  .extend({
    description: z.string().min(1).max(4000).nullable(),
    budget: campaignBudgetSchema.nullable(),
    createdAt: z.iso.datetime(),
    createdBy: z
      .object({
        id: z.uuid(),
        displayName: z.string().min(1).max(120),
      })
      .strict(),
  })
  .strict();

export const campaignListResponseSchema = paginatedListSchema(campaignSummarySchema);

export const campaignDetailResponseSchema = z.object({ data: campaignDetailSchema }).strict();

export type CampaignCreate = z.output<typeof campaignCreateSchema>;
export type CampaignCreateInput = z.input<typeof campaignCreateSchema>;
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;
export type CampaignBudget = z.infer<typeof campaignBudgetSchema>;
export type CampaignUpdate = z.output<typeof campaignUpdateSchema>;
export type CampaignUpdateInput = z.input<typeof campaignUpdateSchema>;
export type CampaignListQuery = z.output<typeof campaignListQuerySchema>;
export type CampaignListQueryInput = z.input<typeof campaignListQuerySchema>;
export type CampaignSummary = z.infer<typeof campaignSummarySchema>;
export type CampaignDetail = z.infer<typeof campaignDetailSchema>;
