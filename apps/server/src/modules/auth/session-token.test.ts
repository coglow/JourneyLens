import { describe, expect, it } from 'vitest';
import { createSessionToken, hashSessionToken } from './session-token.js';

describe('Session token', () => {
  it('生成不可预测 token，只提供其 SHA-256 hash 作为持久化值', () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(hashSessionToken(first.token));
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.tokenHash).not.toBe(first.token);
  });
});
