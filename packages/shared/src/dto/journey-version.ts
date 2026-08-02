import { z } from 'zod';
import { JOURNEY_NODE_TYPES, journeyDraftDefinitionSchema } from '../journeys/journey-draft.js';
import { segmentRuleSchema } from '../segments/segment-rule.js';
import {
  JOURNEY_DESCRIPTION_MAX_LENGTH,
  JOURNEY_NAME_MAX_LENGTH,
  journeyAccountRefSchema,
} from './journey.js';
import { paginatedListSchema, paginationQuerySchema } from './pagination.js';
import { SEGMENT_NAME_MAX_LENGTH } from './segment.js';

/**
 * 发布依据只有两个修订号：旅程修订号覆盖名称、说明、分群绑定和画布保存，
 * 分群修订号补足“只修改分群不会修改旅程”的情况。客户端不能提交快照、发布人或版本号。
 */
export const journeyVersionPublishSchema = z
  .object({
    revision: z.number().int().min(1, '修订号无效'),
    // 不绑定入口分群时必须显式为 null，不能用缺省值代替。
    segmentRevision: z.number().int().min(1, '修订号无效').nullable(),
  })
  .strict();

const journeyVersionSegmentSnapshotSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(SEGMENT_NAME_MAX_LENGTH),
    revision: z.number().int().min(1),
    rules: segmentRuleSchema,
  })
  .strict();

/**
 * 快照里不含画布的部分：发布时画布已单独解析，这里只校验其余字段，
 * 避免同一份画布在一次发布中被完整解析两次。
 */
export const journeyVersionSnapshotMetaSchema = z
  .object({
    name: z.string().min(1).max(JOURNEY_NAME_MAX_LENGTH),
    description: z.string().max(JOURNEY_DESCRIPTION_MAX_LENGTH).nullable(),
    entrySegment: journeyVersionSegmentSnapshotSchema.nullable(),
  })
  .strict();

/** 版本快照：发布那一刻的旅程内容与入口分群规则，读取历史版本时不再查询当前分群。 */
export const journeyVersionSnapshotSchema = journeyVersionSnapshotMetaSchema.extend({
  definition: journeyDraftDefinitionSchema,
});

export const journeyVersionSummarySchema = z
  .object({
    id: z.uuid(),
    journeyId: z.uuid(),
    versionNumber: z.number().int().min(1),
    sourceRevision: z.number().int().min(1),
    sourceSegmentRevision: z.number().int().min(1).nullable(),
    publishedAt: z.iso.datetime(),
    publishedBy: journeyAccountRefSchema,
  })
  .strict();

// 详情在摘要基础上增加快照；列表不复用这个结构，避免把完整画布带进列表响应。
export const journeyVersionDetailSchema = journeyVersionSummarySchema.extend({
  snapshot: journeyVersionSnapshotSchema,
});

export const journeyVersionParamsSchema = z.object({ id: z.uuid(), versionId: z.uuid() }).strict();

export const journeyVersionListQuerySchema = paginationQuerySchema;

/**
 * 运行统计：节点指标以步骤记录为唯一来源，版本汇总来自执行记录，两者口径不同但同一次读取。
 * 条件分支与等待结果只在对应节点类型下给出计数对象，其他类型显式为 null，不用省略字段表达不适用。
 */
const branchCountSchema = z
  .object({ met: z.number().int().min(0), unmet: z.number().int().min(0) })
  .strict();

const waitOutcomeCountSchema = z
  .object({ matched: z.number().int().min(0), timeout: z.number().int().min(0) })
  .strict();

const countSchema = z.number().int().min(0);

export const journeyVersionNodeStatsSchema = z
  .object({
    nodeId: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    nodeType: z.enum(JOURNEY_NODE_TYPES),
    entered: countSchema,
    completed: countSchema,
    waiting: countSchema,
    failed: countSchema,
    stopped: countSchema,
    conditionBranch: branchCountSchema.nullable(),
    waitOutcome: waitOutcomeCountSchema.nullable(),
  })
  .strict();

export const journeyVersionStatsSchema = z
  .object({
    executionCount: countSchema,
    audienceCount: countSchema,
    statusCounts: z
      .object({
        running: countSchema,
        waiting: countSchema,
        completed: countSchema,
        failed: countSchema,
        stopped: countSchema,
      })
      .strict(),
    nodes: z.array(journeyVersionNodeStatsSchema),
  })
  .strict();

export const journeyVersionDetailResponseSchema = z
  .object({ data: journeyVersionDetailSchema })
  .strict();
export const journeyVersionStatsResponseSchema = z
  .object({ data: journeyVersionStatsSchema })
  .strict();
export const journeyVersionListResponseSchema = paginatedListSchema(journeyVersionSummarySchema);

export type JourneyVersionPublish = z.output<typeof journeyVersionPublishSchema>;
export type JourneyVersionPublishInput = z.input<typeof journeyVersionPublishSchema>;
export type JourneyVersionSnapshot = z.infer<typeof journeyVersionSnapshotSchema>;
export type JourneyVersionSummary = z.infer<typeof journeyVersionSummarySchema>;
export type JourneyVersionDetail = z.infer<typeof journeyVersionDetailSchema>;
export type JourneyVersionListQuery = z.output<typeof journeyVersionListQuerySchema>;
export type JourneyVersionNodeStats = z.infer<typeof journeyVersionNodeStatsSchema>;
export type JourneyVersionStats = z.infer<typeof journeyVersionStatsSchema>;
