import { JOURNEY_EVENT_TYPE_LABELS, type CampaignGoal } from '@journeylens/shared';

/** 活动目标文案：未设置目标时直接给出说明，此外始终说明目标行为及是否限制同一商品。 */
export function campaignGoalText(goal: CampaignGoal | null): string {
  if (goal === null) return '未设置目标';
  const label = JOURNEY_EVENT_TYPE_LABELS[goal.eventType];
  return goal.sameProduct ? `${label}（只算同一件商品）` : label;
}
