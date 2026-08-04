import { JOURNEY_EVENT_TYPE_LABELS, type CampaignGoal } from '@journeylens/shared';

/** 活动目标文案：始终说明目标行为，以及是否限制同一商品。 */
export function campaignGoalText(goal: CampaignGoal): string {
  const label = JOURNEY_EVENT_TYPE_LABELS[goal.eventType];
  return goal.sameProduct ? `${label}（只算同一件商品）` : label;
}
