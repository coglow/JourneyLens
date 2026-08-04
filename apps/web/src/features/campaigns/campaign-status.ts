import type { BadgeProps } from 'antd';
import type { CampaignStatus } from '@journeylens/shared';

export const campaignStatusLabels: Record<CampaignStatus, string> = {
  draft: '草稿',
  running: '进行中',
  paused: '已暂停',
  stopped: '已停止',
};

export const campaignStatusBadges: Record<CampaignStatus, NonNullable<BadgeProps['status']>> = {
  draft: 'default',
  running: 'success',
  paused: 'warning',
  stopped: 'error',
};
