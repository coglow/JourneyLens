import { describe, expect, it } from 'vitest';
import { formatElapsedDuration, formatWaitDuration } from './journey-wait';

describe('等待时长摘要', () => {
  it('按能整除的最大单位显示秒、分钟、小时和天', () => {
    expect(formatWaitDuration(30)).toBe('30 秒');
    expect(formatWaitDuration(90)).toBe('90 秒');
    expect(formatWaitDuration(300)).toBe('5 分钟');
    expect(formatWaitDuration(3_600)).toBe('1 小时');
    expect(formatWaitDuration(86_400)).toBe('1 天');
    expect(formatWaitDuration(30 * 24 * 60 * 60)).toBe('30 天');
  });
});

describe('累计等待时长', () => {
  it('按天、小时、分钟和秒拆分并省略为零的单位', () => {
    expect(formatElapsedDuration(0)).toBe('0 秒');
    expect(formatElapsedDuration(30)).toBe('30 秒');
    expect(formatElapsedDuration(90)).toBe('1 分钟 30 秒');
    expect(formatElapsedDuration(3_600)).toBe('1 小时');
    expect(formatElapsedDuration(86_400)).toBe('1 天');
    expect(formatElapsedDuration(176_400)).toBe('2 天 1 小时');
    expect(formatElapsedDuration(90_061)).toBe('1 天 1 小时 1 分钟 1 秒');
  });

  it('不产生负数时长', () => {
    expect(formatElapsedDuration(-60)).toBe('0 秒');
  });
});
