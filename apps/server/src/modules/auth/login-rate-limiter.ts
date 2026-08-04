import { ApiError } from '../../errors.js';

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

interface AttemptWindow {
  count: number;
  resetAt: number;
}

export class LoginRateLimiter {
  private readonly attempts = new Map<string, AttemptWindow>();
  private nextCleanupAt = 0;

  constructor(private readonly now: () => number = Date.now) {}

  consume(key: string): void {
    const now = this.now();
    if (now >= this.nextCleanupAt) {
      for (const [candidate, window] of this.attempts) {
        if (window.resetAt <= now) this.attempts.delete(candidate);
      }
      this.nextCleanupAt = now + 60_000;
    }

    let window = this.attempts.get(key);
    if (window === undefined || window.resetAt <= now) {
      window = { count: 0, resetAt: now + WINDOW_MS };
      this.attempts.set(key, window);
    }
    if (window.count >= MAX_ATTEMPTS) {
      throw new ApiError(429, 'RATE_LIMITED', '登录尝试过多，请稍后再试', {
        retryAfterSeconds: Math.ceil((window.resetAt - now) / 1000),
      });
    }
    window.count += 1;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}
