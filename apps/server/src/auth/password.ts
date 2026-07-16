import { hash, verify } from '@node-rs/argon2';

export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$HlgvGKGCcwEOu5knwD7tuw$kSKPVZhleihOGFFugzjUHaS49sHphEVnYmDw35Yx3sY';

export const ARGON2_OPTIONS = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export type PasswordVerifier = (hashValue: string, password: string) => Promise<boolean>;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  return verify(hashValue, password);
}
