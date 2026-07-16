import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { CurrentAccount } from '@journeylens/shared';
import { ApiError } from '../errors.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { DUMMY_PASSWORD_HASH, verifyPassword } from './password.js';
import type { PasswordVerifier } from './password.js';
import { createSessionToken } from './session-token.js';

export const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_COOKIE_NAME = 'journeylens_session';

function invalidCredentials(): ApiError {
  return new ApiError(401, 'INVALID_CREDENTIALS', '邮箱或密码不正确');
}

function toCurrentAccount(account: {
  id: string;
  email: string;
  displayName: string;
}): CurrentAccount {
  return { id: account.id, email: account.email, displayName: account.displayName };
}

export interface AuthServiceOptions {
  prisma: PrismaClient;
  verifyPassword?: PasswordVerifier | undefined;
  now?: (() => Date) | undefined;
}

export class AuthService {
  private readonly verify: PasswordVerifier;
  private readonly rateLimiter = new LoginRateLimiter();
  private readonly now: () => Date;

  constructor(private readonly options: AuthServiceOptions) {
    this.verify = options.verifyPassword ?? verifyPassword;
    this.now = options.now ?? (() => new Date());
  }

  async login(input: {
    email: string;
    password: string;
    ip: string;
  }): Promise<{ account: CurrentAccount; token: string; expiresAt: Date }> {
    const emailNormalized = input.email.trim().toLowerCase();
    const limiterKey = `${input.ip}:${emailNormalized}`;
    this.rateLimiter.consume(limiterKey);

    const account = await this.options.prisma.operatorAccount.findUnique({
      where: { emailNormalized },
    });
    if (account === null || account.status !== 'active') {
      await this.verify(DUMMY_PASSWORD_HASH, input.password);
      throw invalidCredentials();
    }
    if (!(await this.verify(account.passwordHash, input.password))) {
      throw invalidCredentials();
    }

    const now = this.now();
    const { token, tokenHash } = createSessionToken();
    const expiresAt = new Date(now.getTime() + DEFAULT_SESSION_TTL_SECONDS * 1000);
    await this.options.prisma.$transaction(async (tx) => {
      await tx.session.create({
        data: {
          id: randomUUID(),
          accountId: account.id,
          tokenHash,
          expiresAt,
        },
      });
      await tx.operatorAccount.update({
        where: { id: account.id },
        data: { lastLoginAt: now },
      });
    });

    this.rateLimiter.reset(limiterKey);
    return { account: toCurrentAccount(account), token, expiresAt };
  }

  async getSessionAccount(tokenHash: string, now = this.now()): Promise<CurrentAccount | null> {
    const session = await this.options.prisma.session.findUnique({
      where: { tokenHash },
      include: { account: true },
    });
    if (
      session === null ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= now.getTime() ||
      session.account.status !== 'active'
    ) {
      return null;
    }
    return toCurrentAccount(session.account);
  }

  async logout(tokenHash: string, now = this.now()): Promise<void> {
    await this.options.prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: now },
    });
  }
}
