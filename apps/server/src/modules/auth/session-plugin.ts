import type { FastifyInstance } from 'fastify';
import type { CurrentAccount } from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import type { AuthService } from './auth-service.js';
import { SESSION_COOKIE_NAME } from './auth-service.js';
import { hashSessionToken } from './session-token.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentAccount?: CurrentAccount;
  }
}

export function registerSessionGuard(app: FastifyInstance, service: AuthService): void {
  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0]?.replace(/\/+$/, '') || '/';
    if (!path.startsWith('/api/')) return;
    if (path === '/api/auth/login' || path === '/api/auth/logout') return;

    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (!token) throw new ApiError(401, 'AUTH_REQUIRED', '需要登录');

    const account = await service.getSessionAccount(hashSessionToken(token));
    if (account === null) throw new ApiError(401, 'AUTH_REQUIRED', '登录已失效');
    request.currentAccount = account;
  });
}
