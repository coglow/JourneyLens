import { describe, expect, it } from 'vitest';
import { campaignOverviewResponseSchema } from './campaign.js';

const campaignId = '00000000-0000-4000-8000-000000000001';

describe('活动运行概览契约', () => {
  it('接受完整状态分布和零值', () => {
    expect(
      campaignOverviewResponseSchema.parse({
        data: {
          campaignId,
          executionCount: 3,
          audienceCount: 2,
          statusCounts: { running: 1, waiting: 0, completed: 1, failed: 0, stopped: 1 },
          goalReachedCount: 0,
        },
      }).data.statusCounts,
    ).toEqual({ running: 1, waiting: 0, completed: 1, failed: 0, stopped: 1 });

    expect(
      campaignOverviewResponseSchema.parse({
        data: {
          campaignId,
          executionCount: 0,
          audienceCount: 0,
          statusCounts: { running: 0, waiting: 0, completed: 0, failed: 0, stopped: 0 },
          goalReachedCount: null,
        },
      }).data.executionCount,
    ).toBe(0);
  });

  it('拒绝负数、小数和缺少状态的响应', () => {
    const response = {
      data: {
        campaignId,
        executionCount: 1,
        audienceCount: 1,
        statusCounts: { running: 1, waiting: 0, completed: 0, failed: 0, stopped: 0 },
        goalReachedCount: null,
      },
    };

    expect(
      campaignOverviewResponseSchema.safeParse({
        ...response,
        data: { ...response.data, executionCount: -1 },
      }).success,
    ).toBe(false);
    expect(
      campaignOverviewResponseSchema.safeParse({
        ...response,
        data: { ...response.data, audienceCount: 1.5 },
      }).success,
    ).toBe(false);
    expect(
      campaignOverviewResponseSchema.safeParse({
        data: {
          ...response.data,
          statusCounts: { running: 1, waiting: 0, completed: 0, failed: 0 },
        },
      }).success,
    ).toBe(false);
    // 目标达成次数必须明确返回：省略字段不能用 0 或 null 代替。
    expect(
      campaignOverviewResponseSchema.safeParse({
        data: {
          campaignId,
          executionCount: 0,
          audienceCount: 0,
          statusCounts: { running: 0, waiting: 0, completed: 0, failed: 0, stopped: 0 },
        },
      }).success,
    ).toBe(false);
  });

  it('未设置目标返回 null，已设置但无人达成返回 0', () => {
    const base = {
      campaignId,
      executionCount: 1,
      audienceCount: 1,
      statusCounts: { running: 0, waiting: 0, completed: 1, failed: 0, stopped: 0 },
    };
    expect(
      campaignOverviewResponseSchema.parse({ data: { ...base, goalReachedCount: null } }).data
        .goalReachedCount,
    ).toBeNull();
    expect(
      campaignOverviewResponseSchema.parse({ data: { ...base, goalReachedCount: 0 } }).data
        .goalReachedCount,
    ).toBe(0);
  });
});
