import { vi } from 'vitest';
import { buildApp, type AppLoggerOption } from '../app.js';
import { testNow, type TestDatabase } from './test-database.js';

export function makeApp(db: TestDatabase, logger: AppLoggerOption = false) {
  const verifyPassword = vi.fn(async (hash: string, password: string) => {
    return hash === 'stored-argon2-hash' && password === 'correct-password';
  });
  const app = buildApp({
    prisma: db.prisma,
    verifyPassword,
    now: () => testNow,
    logger,
  });
  return { app, verifyPassword };
}

export type TestApp = ReturnType<typeof makeApp>['app'];

export async function login(
  app: TestApp,
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

export function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers['set-cookie'];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(first).split(';')[0] ?? '';
}

/** 登录并返回可直接放进请求头的 Cookie。 */
export async function signedInCookie(app: TestApp): Promise<string> {
  return cookieFrom(await login(app));
}

/** 写请求（POST / PATCH）需要的请求头。 */
export function jsonHeaders(cookie: string) {
  return {
    host: 'localhost',
    origin: 'http://localhost',
    cookie,
    'content-type': 'application/json',
  };
}
