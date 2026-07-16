import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors.js';
import { LoginRateLimiter } from './login-rate-limiter.js';

describe('登录尝试限流', () => {
  it('允许 5 次尝试，第 6 次返回可核对的等待时间，窗口过期后恢复', () => {
    let now = 1_000;
    const limiter = new LoginRateLimiter(() => now);

    for (let attempt = 0; attempt < 5; attempt += 1) limiter.consume('ip:email');
    let failure: unknown;
    try {
      limiter.consume('ip:email');
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 900,
    });

    now += 15 * 60 * 1000;
    expect(() => limiter.consume('ip:email')).not.toThrow();
  });

  it('不同账号键互不影响，成功后可清空对应计数', () => {
    const limiter = new LoginRateLimiter(() => 1_000);
    for (let attempt = 0; attempt < 5; attempt += 1) limiter.consume('ip:email');
    expect(() => limiter.consume('ip:other')).not.toThrow();
    limiter.reset('ip:email');
    expect(() => limiter.consume('ip:email')).not.toThrow();
  });
});
