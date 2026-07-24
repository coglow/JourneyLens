import { describe, expect, it } from 'vitest';
import { formatWaitDuration } from './journey-wait';

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
