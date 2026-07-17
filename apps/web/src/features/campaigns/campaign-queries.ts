import type { CampaignListQueryInput } from '@journeylens/shared';

export const campaignQueryKeys = {
  lists: ['campaigns', 'list'] as const,
  list: (input: CampaignListQueryInput) => [...campaignQueryKeys.lists, input] as const,
  detail: (id: string) => ['campaigns', 'detail', id] as const,
};
