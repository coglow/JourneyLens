import { describe, expect, it } from 'vitest';
import {
  journeyVersionDetailSchema,
  journeyVersionListResponseSchema,
  journeyVersionPublishSchema,
  journeyVersionStatsResponseSchema,
  journeyVersionSummarySchema,
} from './journey-version.js';

const accountId = '00000000-0000-4000-8000-000000000001';
const journeyId = '00000000-0000-4000-8000-000000000002';
const versionId = '00000000-0000-4000-8000-000000000003';

const segmentRule = {
  kind: 'compare' as const,
  left: { source: 'user' as const, path: 'age' },
  operator: 'gte' as const,
  right: 18,
};

const definition = {
  layoutDirection: 'vertical' as const,
  nodes: [
    {
      id: 'n-start',
      type: 'start' as const,
      name: '开始',
      position: { x: 0, y: 0 },
      entryBehavior: 'app_session_started' as const,
    },
    { id: 'n-end', type: 'end' as const, name: '结束', position: { x: 0, y: 120 }, note: null },
  ],
  edges: [{ id: 'e-1', source: 'n-start', target: 'n-end' }],
};

const summary = {
  id: versionId,
  journeyId,
  versionNumber: 1,
  sourceRevision: 8,
  sourceSegmentRevision: null,
  publishedAt: '2026-07-23T08:00:00.000Z',
  publishedBy: { id: accountId, displayName: '测试运营账号' },
};

const snapshot = {
  name: '版本冻结验收',
  description: null,
  definition,
  entrySegment: {
    id: accountId,
    name: '版本验收人群',
    revision: 3,
    rules: segmentRule,
  },
};

describe('旅程版本契约', () => {
  it('发布依据必须同时提交旅程修订号和分群修订号，不限人群显式为 null', () => {
    expect(journeyVersionPublishSchema.parse({ revision: 8, segmentRevision: 3 })).toEqual({
      revision: 8,
      segmentRevision: 3,
    });
    expect(
      journeyVersionPublishSchema.parse({ revision: 8, segmentRevision: null }).segmentRevision,
    ).toBeNull();

    for (const payload of [
      { revision: 8 },
      { segmentRevision: 3 },
      { revision: 8, segmentRevision: undefined },
      { revision: 0, segmentRevision: null },
      { revision: 8, segmentRevision: 0 },
      { revision: 1.5, segmentRevision: null },
      { revision: 8, segmentRevision: null, snapshot },
      { revision: '8', segmentRevision: null },
    ]) {
      expect(journeyVersionPublishSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('版本摘要不接受快照，列表不会带出完整画布', () => {
    expect(journeyVersionSummarySchema.parse(summary)).toEqual(summary);
    expect(journeyVersionSummarySchema.safeParse({ ...summary, snapshot }).success).toBe(false);
    expect(journeyVersionSummarySchema.safeParse({ ...summary, versionNumber: 0 }).success).toBe(
      false,
    );
    expect(
      journeyVersionSummarySchema.safeParse({ ...summary, sourceSegmentRevision: undefined })
        .success,
    ).toBe(false);
  });

  it('版本详情必须带合法快照，快照字段不接受多余内容', () => {
    const detail = { ...summary, snapshot };
    expect(journeyVersionDetailSchema.parse(detail).snapshot.definition.nodes).toHaveLength(2);
    expect(journeyVersionDetailSchema.safeParse(summary).success).toBe(false);
    expect(
      journeyVersionDetailSchema.safeParse({
        ...detail,
        snapshot: { ...snapshot, entrySegment: { ...snapshot.entrySegment, extra: true } },
      }).success,
    ).toBe(false);
    expect(
      journeyVersionDetailSchema.safeParse({
        ...detail,
        snapshot: { ...snapshot, extra: true },
      }).success,
    ).toBe(false);
    expect(
      journeyVersionDetailSchema.safeParse({
        ...detail,
        snapshot: { ...snapshot, definition: { ...definition, nodes: [] } },
      }).success,
    ).toBe(false);
  });

  it('版本列表沿用统一分页结构', () => {
    const parsed = journeyVersionListResponseSchema.parse({
      data: [summary],
      page: { page: 1, pageSize: 10, total: 1 },
    });
    expect(parsed.data).toHaveLength(1);
    expect(
      journeyVersionListResponseSchema.safeParse({
        data: [summary],
        page: { page: 1, pageSize: 5, total: 1 },
      }).success,
    ).toBe(false);
    expect(journeyVersionListResponseSchema.safeParse({ data: [summary] }).success).toBe(false);
  });

  it('运行统计同时接受节点型计数对象与 null，缺少字段则拒绝', () => {
    const stats = {
      executionCount: 2,
      audienceCount: 1,
      statusCounts: { running: 0, waiting: 0, completed: 2, failed: 0, stopped: 0 },
      nodes: [
        {
          nodeId: 'n-condition',
          name: '价格判断',
          nodeType: 'condition',
          entered: 2,
          completed: 2,
          waiting: 0,
          failed: 0,
          stopped: 0,
          conditionBranch: { met: 1, unmet: 1 },
          waitOutcome: null,
        },
        {
          nodeId: 'n-wait-event',
          name: '等待购买',
          nodeType: 'wait_for_event',
          entered: 1,
          completed: 1,
          waiting: 0,
          failed: 0,
          stopped: 0,
          conditionBranch: null,
          waitOutcome: { matched: 1, timeout: 0 },
        },
      ],
    };

    expect(journeyVersionStatsResponseSchema.parse({ data: stats }).data).toEqual(stats);

    // 节点类型与可空字段的关系不是契约能保证的，但字段本身不能省略，计数也不能为负。
    for (const invalid of [
      { ...stats, executionCount: -1 },
      { ...stats, nodes: [{ ...stats.nodes[0], conditionBranch: undefined }] },
      { ...stats, nodes: [{ ...stats.nodes[1], waitOutcome: { matched: 1 } }] },
      { ...stats, nodes: [{ ...stats.nodes[0], nodeType: 'unknown' }] },
      { ...stats, statusCounts: { running: 0, waiting: 0, completed: 2 } },
      { ...stats, audienceCount: 1.5 },
    ]) {
      expect(journeyVersionStatsResponseSchema.safeParse({ data: invalid }).success).toBe(false);
    }
  });
});
