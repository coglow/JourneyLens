import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashSessionToken } from '../modules/auth/session-token.js';
import {
  startTestDatabase,
  testAccountId,
  testNow,
  type TestDatabase,
} from '../test-support/test-database.js';
import {
  cookieFrom,
  jsonHeaders,
  login,
  makeApp,
  signedInCookie,
  type TestApp,
} from '../test-support/harness.js';

const campaignId = '00000000-0000-4000-8000-000000000001';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

beforeEach(async () => {
  await db.reset();
});

afterAll(async () => {
  await db.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function sessionOf(cookie: string) {
  const token = cookie.slice(cookie.indexOf('=') + 1);
  const session = await db.prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
  });
  if (session === null) throw new Error('测试库中找不到当前会话');
  return session;
}

/** 401 决定发生在鉴权层：读、写接口都应统一拒绝，而不是让请求走到业务逻辑。 */
async function expectAllProtectedRequestsRejected(app: TestApp, cookie: string): Promise<void> {
  const profile = await app.inject({ method: 'GET', url: '/api/userinfo', headers: { cookie } });
  expect(profile.statusCode).toBe(401);

  const list = await app.inject({ method: 'GET', url: '/api/campaigns', headers: { cookie } });
  expect(list.statusCode).toBe(401);

  const patch = await app.inject({
    method: 'PATCH',
    url: `/api/campaigns/${campaignId}`,
    headers: jsonHeaders(cookie),
    payload: { name: '不能修改' },
  });
  expect(patch.statusCode).toBe(401);

  const deletion = await app.inject({
    method: 'DELETE',
    url: `/api/campaigns/${campaignId}`,
    headers: { host: 'localhost', origin: 'http://localhost', cookie },
  });
  expect(deletion.statusCode).toBe(401);
}

describe('认证 API', () => {
  it('登录成功返回脱敏账号，并下发只存 token 哈希的 HttpOnly Cookie', async () => {
    const { app } = makeApp(db);
    try {
      const response = await login(app, 'Operator@Example.com');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        data: { id: testAccountId, email: 'Operator@Example.com', displayName: '测试运营账号' },
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

      const sessions = await db.prisma.session.findMany();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.tokenHash).toBe(hashSessionToken(token));
      expect(sessions[0]?.tokenHash).not.toBe(token);
    } finally {
      await app.close();
    }
  });

  it('携带登录 Cookie 访问 /api/userinfo 返回同一账号', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const current = await app.inject({
        method: 'GET',
        url: '/api/userinfo',
        headers: { cookie },
      });
      expect(current.statusCode).toBe(200);
      expect(current.json()).toEqual({
        data: { id: testAccountId, email: 'Operator@Example.com', displayName: '测试运营账号' },
      });
    } finally {
      await app.close();
    }
  });

  it('错误密码、未知邮箱和禁用账号返回相同认证失败且不创建 Session', async () => {
    const { app, verifyPassword } = makeApp(db);
    try {
      const wrong = await login(app, 'operator@example.com', 'wrong-password');
      const unknown = await login(app, 'nobody@example.com');

      await db.prisma.operatorAccount.update({
        where: { id: testAccountId },
        data: { status: 'disabled' },
      });
      const disabledResponse = await login(app);

      expect(wrong.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      expect(disabledResponse.statusCode).toBe(401);
      expect(wrong.json()).toMatchObject({
        error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码不正确' },
      });
      expect(unknown.json()).toMatchObject({
        error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码不正确' },
      });
      expect(disabledResponse.json()).toMatchObject({
        error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码不正确' },
      });
      expect(await db.prisma.session.count()).toBe(0);
      expect(verifyPassword).toHaveBeenCalledWith(
        expect.stringMatching(/^\$argon2id\$/),
        'correct-password',
      );
    } finally {
      await app.close();
    }
  });

  it('会话过期后所有受保护接口返回 401', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const session = await sessionOf(cookie);
      await db.prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(testNow.getTime() - 1) },
      });
      await expectAllProtectedRequestsRejected(app, cookie);
    } finally {
      await app.close();
    }
  });

  it('会话撤销后所有受保护接口返回 401', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const session = await sessionOf(cookie);
      await db.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: testNow },
      });
      await expectAllProtectedRequestsRejected(app, cookie);
    } finally {
      await app.close();
    }
  });

  it('账号被禁用后所有受保护接口返回 401', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      await db.prisma.operatorAccount.update({
        where: { id: testAccountId },
        data: { status: 'disabled' },
      });
      await expectAllProtectedRequestsRejected(app, cookie);
    } finally {
      await app.close();
    }
  });

  it('退出撤销旧 Session 并清 Cookie，重复退出仍成功', async () => {
    const { app } = makeApp(db);
    try {
      const cookie = await signedInCookie(app);
      const token = cookie.slice(cookie.indexOf('=') + 1);

      const signedOut = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { host: 'localhost', origin: 'http://localhost', cookie },
      });
      expect(signedOut.statusCode).toBe(204);
      expect(String(signedOut.headers['set-cookie'])).toContain('Max-Age=0');

      const session = await db.prisma.session.findUnique({
        where: { tokenHash: hashSessionToken(token) },
      });
      expect(session?.revokedAt).toEqual(testNow);

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
    const { app } = makeApp(db);
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

  it('拒绝错误 Origin 和非 JSON 登录', async () => {
    const { app } = makeApp(db);
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
    } finally {
      await app.close();
    }
  });

  it('活跃检查公开，其他 /api 路由默认受保护', async () => {
    const { app } = makeApp(db);
    try {
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
