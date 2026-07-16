import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { hashSessionToken } from './auth/session-token.js';

const accountId = 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120';
const now = new Date('2026-07-16T08:00:00.000Z');

interface TestAccount {
  id: string;
  email: string;
  emailNormalized: string;
  passwordHash: string;
  displayName: string;
  status: 'active' | 'disabled';
  lastLoginAt: Date | null;
}

interface TestSession {
  id: string;
  accountId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

function makePrisma(initialStatus: TestAccount['status'] = 'active') {
  let account: TestAccount = {
    id: accountId,
    email: 'Operator@Example.com',
    emailNormalized: 'operator@example.com',
    passwordHash: 'stored-argon2-hash',
    displayName: '测试运营账号',
    status: initialStatus,
    lastLoginAt: null,
  };
  const sessions = new Map<string, TestSession>();
  const client: {
    operatorAccount: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    session: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
    $disconnect: ReturnType<typeof vi.fn>;
  } = {
    operatorAccount: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; emailNormalized?: string } }) => {
        if (where.id !== undefined) return account.id === where.id ? account : null;
        return account.emailNormalized === where.emailNormalized ? account : null;
      }),
      update: vi.fn(async ({ data }: { data: { lastLoginAt: Date } }) => {
        account = { ...account, lastLoginAt: data.lastLoginAt };
        return account;
      }),
    },
    session: {
      create: vi.fn(async ({ data }: { data: TestSession }) => {
        sessions.set(data.tokenHash, { ...data, revokedAt: null });
        return data;
      }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const session = sessions.get(where.tokenHash);
        return session === undefined ? null : { ...session, account };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { tokenHash: string; revokedAt: null };
          data: { revokedAt: Date };
        }) => {
          const session = sessions.get(where.tokenHash);
          if (session === undefined || session.revokedAt !== where.revokedAt) return { count: 0 };
          sessions.set(where.tokenHash, { ...session, revokedAt: data.revokedAt });
          return { count: 1 };
        },
      ),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(client)),
    $disconnect: vi.fn(async () => undefined),
  };

  return {
    prisma: client as unknown as PrismaClient,
    sessions,
    setStatus(status: TestAccount['status']) {
      account = { ...account, status };
    },
  };
}

function makeApp(initialStatus: TestAccount['status'] = 'active') {
  const db = makePrisma(initialStatus);
  const verifyPassword = vi.fn(async (hash: string, password: string) => {
    return hash === 'stored-argon2-hash' && password === 'correct-password';
  });
  const app = buildApp({ prisma: db.prisma, verifyPassword, now: () => now });
  return { app, ...db, verifyPassword };
}

async function login(
  app: ReturnType<typeof buildApp>,
  email = 'operator@example.com',
  password = 'correct-password',
) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      'content-type': 'application/json',
    },
    payload: { email, password },
  });
}

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers['set-cookie'];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(first).split(';')[0] ?? '';
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('认证 API', () => {
  it('登录设置仅含 token 的 HttpOnly Cookie，/api/userinfo 返回脱敏账号', async () => {
    const { app, sessions } = makeApp();
    try {
      const response = await login(app, 'Operator@Example.com');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        data: { id: accountId, email: 'Operator@Example.com', displayName: '测试运营账号' },
      });

      const setCookie = String(response.headers['set-cookie']);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Path=/');
      expect(setCookie).toContain('Max-Age=604800');
      expect(setCookie).not.toContain('Secure');
      const cookie = cookieFrom(response);
      const token = cookie.slice(cookie.indexOf('=') + 1);
      expect(token.length).toBeGreaterThan(20);
      expect([...sessions.keys()]).toEqual([hashSessionToken(token)]);
      expect(sessions.has(token)).toBe(false);

      const current = await app.inject({
        method: 'GET',
        url: '/api/userinfo',
        headers: { cookie },
      });
      expect(current.statusCode).toBe(200);
      expect(current.json()).toEqual(response.json());
    } finally {
      await app.close();
    }
  });

  it('错误密码、未知邮箱和禁用账号返回相同认证失败且不创建 Session', async () => {
    const active = makeApp();
    const disabled = makeApp('disabled');
    try {
      const wrong = await login(active.app, 'operator@example.com', 'wrong-password');
      const unknown = await login(active.app, 'nobody@example.com');
      const disabledResponse = await login(disabled.app);
      expect(wrong.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      expect(disabledResponse.statusCode).toBe(401);
      expect(wrong.json()).toEqual(unknown.json());
      expect(wrong.json()).toEqual(disabledResponse.json());
      expect(active.sessions.size).toBe(0);
      expect(disabled.sessions.size).toBe(0);
      expect(active.verifyPassword).toHaveBeenCalledWith(
        expect.stringMatching(/^\$argon2id\$/),
        'correct-password',
      );
    } finally {
      await active.app.close();
      await disabled.app.close();
    }
  });

  it('会话过期、撤销或账号禁用后 /api/userinfo 均返回 401', async () => {
    const { app, sessions, setStatus } = makeApp();
    try {
      const response = await login(app);
      const cookie = cookieFrom(response);
      const token = cookie.slice(cookie.indexOf('=') + 1);
      const tokenHash = hashSessionToken(token);
      const session = sessions.get(tokenHash);
      expect(session).toBeDefined();

      if (session) sessions.set(tokenHash, { ...session, expiresAt: new Date(now.getTime() - 1) });
      const expired = await app.inject({
        method: 'GET',
        url: '/api/userinfo',
        headers: { cookie },
      });
      expect(expired.statusCode).toBe(401);

      if (session)
        sessions.set(tokenHash, {
          ...session,
          expiresAt: new Date(now.getTime() + 1_000),
          revokedAt: now,
        });
      const revoked = await app.inject({
        method: 'GET',
        url: '/api/userinfo',
        headers: { cookie },
      });
      expect(revoked.statusCode).toBe(401);

      if (session)
        sessions.set(tokenHash, {
          ...session,
          expiresAt: new Date(now.getTime() + 1_000),
          revokedAt: null,
        });
      setStatus('disabled');
      const disabled = await app.inject({
        method: 'GET',
        url: '/api/userinfo',
        headers: { cookie },
      });
      expect(disabled.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('退出撤销旧 Session 并清 Cookie，重复退出仍成功', async () => {
    const { app, sessions } = makeApp();
    try {
      const signedIn = await login(app);
      const cookie = cookieFrom(signedIn);
      const token = cookie.slice(cookie.indexOf('=') + 1);

      const signedOut = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { host: 'localhost', origin: 'http://localhost', cookie },
      });
      expect(signedOut.statusCode).toBe(204);
      expect(String(signedOut.headers['set-cookie'])).toContain('Max-Age=0');
      expect(sessions.get(hashSessionToken(token))?.revokedAt).toEqual(now);

      const oldSession = await app.inject({
        method: 'GET',
        url: '/api/userinfo',
        headers: { cookie },
      });
      expect(oldSession.statusCode).toBe(401);

      const repeated = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { host: 'localhost', origin: 'http://localhost' },
      });
      expect(repeated.statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });

  it('六次失败尝试后准确返回 429 和剩余等待秒数', async () => {
    const { app } = makeApp();
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await login(app, 'operator@example.com', 'wrong-password')).statusCode).toBe(401);
      }
      const limited = await login(app, 'operator@example.com', 'wrong-password');
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.code).toBe('RATE_LIMITED');
      expect(Number(limited.headers['retry-after'])).toBe(900);
    } finally {
      await app.close();
    }
  });

  it('拒绝错误 Origin 和非 JSON 登录；活跃检查公开，其他 /api 路由默认受保护', async () => {
    const { app } = makeApp();
    try {
      const badOrigin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          host: 'localhost',
          origin: 'https://evil.example',
          'content-type': 'application/json',
        },
        payload: { email: 'operator@example.com', password: 'correct-password' },
      });
      expect(badOrigin.statusCode).toBe(403);

      const noOrigin = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { host: 'localhost' },
      });
      expect(noOrigin.statusCode).toBe(403);

      const nonJson = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          host: 'localhost',
          origin: 'http://localhost',
          'content-type': 'text/plain',
        },
        payload: 'email=operator@example.com',
      });
      expect(nonJson.statusCode).toBe(415);

      expect((await app.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
      expect(
        (await app.inject({ method: 'GET', url: '/api/future-business-route' })).statusCode,
      ).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/api/userinfo' })).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
