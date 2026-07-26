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

/**
 * 累计等待时长：按天、小时、分钟、秒拆分，省略为零的单位。
 * 节点设置仍用 formatWaitDuration 显示单个整单位，两处共用同一份单位目录。
 */
export function formatElapsedDuration(totalSeconds: number): string {
  let remaining = Math.max(0, Math.floor(totalSeconds));
  const parts: string[] = [];
  for (const unit of [...WAIT_UNITS].reverse()) {
    const count = Math.floor(remaining / unit.seconds);
    if (count === 0) continue;
    parts.push(`${count} ${unit.label}`);
    remaining -= count * unit.seconds;
  }
  return parts.length === 0 ? '0 秒' : parts.join(' ');
}
