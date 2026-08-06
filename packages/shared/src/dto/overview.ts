import { z } from 'zod';
import { campaignRefSchema, campaignStatusSchema } from './campaign.js';

const countSchema = z.number().int().nonnegative();

export const overviewSchema = z
  .object({
    windowStartedAt: z.iso.datetime(),
    windowEndedAt: z.iso.datetime(),
    campaignStatusCounts: z
      .object({
        draft: countSchema,
        running: countSchema,
        paused: countSchema,
        stopped: countSchema,
      })
      .strict(),
    entryCount: countSchema,
    goalReachedCount: countSchema,
    failedCount: countSchema,
    recentJourneys: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string().min(1).max(180),
            campaign: campaignRefSchema,
            versionId: z.uuid(),
            versionNumber: z.number().int().min(1),
            publishedAt: z.iso.datetime(),
          })
          .strict(),
      )
      .max(5),
    recentCampaigns: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string().min(1).max(180),
            status: campaignStatusSchema,
            entryCount: countSchema,
            goalReachedCount: countSchema.nullable(),
            failedCount: countSchema,
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

export const overviewResponseSchema = z.object({ data: overviewSchema }).strict();
export type Overview = z.infer<typeof overviewSchema>;
