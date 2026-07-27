import type { JourneyListQueryInput, PaginationQueryInput } from '@journeylens/shared';

export const journeyQueryKeys = {
  lists: ['journeys', 'list'] as const,
  list: (campaignId: string, input: JourneyListQueryInput) =>
    [...journeyQueryKeys.lists, campaignId, input] as const,
  detail: (id: string) => ['journeys', 'detail', id] as const,
  /** 发布确认用的独立读取，避免把确认内容写回草稿缓存。 */
  publishCheck: (id: string) => ['journeys', 'publish-check', id] as const,
};

export const journeyVersionQueryKeys = {
  /** 按旅程失效全部版本查询；列表和详情分开缓存。 */
  all: (journeyId: string) => ['journey-versions', journeyId] as const,
  list: (journeyId: string, input: PaginationQueryInput) =>
    [...journeyVersionQueryKeys.all(journeyId), 'list', input] as const,
  detail: (journeyId: string, versionId: string) =>
    [...journeyVersionQueryKeys.all(journeyId), 'detail', versionId] as const,
};
