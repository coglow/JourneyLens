import type { JourneyListQueryInput } from '@journeylens/shared';

export const journeyQueryKeys = {
  lists: ['journeys', 'list'] as const,
  list: (campaignId: string, input: JourneyListQueryInput) =>
    [...journeyQueryKeys.lists, campaignId, input] as const,
  detail: (id: string) => ['journeys', 'detail', id] as const,
};
