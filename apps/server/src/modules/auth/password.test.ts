import { describe, expect, it } from 'vitest';
import { ARGON2_OPTIONS, hashPassword, verifyPassword } from './password.js';

describe('Argon2id 密码工具', () => {
  it('使用 Argon2id hash 并可验证密码', async () => {
    expect(ARGON2_OPTIONS).toEqual({
      algorithm: 2,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    const password = 'correct-horse-battery-staple';
    const hashValue = await hashPassword(password);

    expect(hashValue.startsWith('$argon2id$')).toBe(true);
    expect(hashValue).not.toContain(password);
    expect(await verifyPassword(hashValue, password)).toBe(true);
    expect(await verifyPassword(hashValue, 'wrong-password')).toBe(false);
  });
});
