import type { BadgeProps } from 'antd';
import {
  EXECUTION_STATUS_LABELS,
  EXECUTION_STEP_STATUS_LABELS,
  type ExecutionStatus,
} from '@journeylens/shared';

export const executionStatusLabels = EXECUTION_STATUS_LABELS;
export const executionStepStatusLabels = EXECUTION_STEP_STATUS_LABELS;

export const executionStatusBadges: Record<ExecutionStatus, NonNullable<BadgeProps['status']>> = {
  running: 'processing',
  waiting: 'warning',
  completed: 'success',
  failed: 'error',
  stopped: 'default',
};
