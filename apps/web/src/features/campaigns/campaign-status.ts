import type { BadgeProps } from 'antd';
import type { CampaignStatus } from '@journeylens/shared';

export const campaignStatusLabels: Record<CampaignStatus, string> = {
  draft: '草稿',
  scheduled: '已排期',
  running: '进行中',
  ended: '已结束',
  stopped: '已停止',
};

export const campaignStatusBadges: Record<CampaignStatus, NonNullable<BadgeProps['status']>> = {
  draft: 'default',
  scheduled: 'processing',
  running: 'success',
  ended: 'warning',
  stopped: 'error',
};
