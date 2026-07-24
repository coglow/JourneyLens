export type WaitUnit = 'seconds' | 'minutes' | 'hours' | 'days';

/** 等待时长的单位目录；设置面板选择单位和卡片摘要共用同一份换算。 */
export const WAIT_UNITS = [
  { label: '秒', value: 'seconds', seconds: 1 },
  { label: '分钟', value: 'minutes', seconds: 60 },
  { label: '小时', value: 'hours', seconds: 3_600 },
  { label: '天', value: 'days', seconds: 86_400 },
] as const;

/** 取能整除该秒数的最大单位；例如 3600 取小时，90 秒仍按秒显示。 */
export function waitUnitFor(seconds: number): (typeof WAIT_UNITS)[number] {
  for (const unit of [...WAIT_UNITS].reverse()) {
    if (seconds >= unit.seconds && seconds % unit.seconds === 0) return unit;
  }
  return WAIT_UNITS[0];
}

export function formatWaitDuration(seconds: number): string {
  const unit = waitUnitFor(seconds);
  return `${seconds / unit.seconds} ${unit.label}`;
}
