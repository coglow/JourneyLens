import type { FastifyInstance } from 'fastify';
import { currentAccountResponseSchema, loginRequestSchema } from '@journeylens/shared';
import { ApiError } from '../../errors.js';
import type { AuthService } from './auth-service.js';
import { DEFAULT_SESSION_TTL_SECONDS, SESSION_COOKIE_NAME } from './auth-service.js';
import { hashSessionToken } from './session-token.js';

export interface AuthRouteOptions {
  service: AuthService;
  now?: (() => Date) | undefined;
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  app.post('/api/auth/login', async (request, reply) => {
    const body = loginRequestSchema.safeParse(request.body);
    if (!body.success) throw new ApiError(400, 'BAD_REQUEST', '请检查邮箱和密码格式');

    const result = await options.service.login({ ...body.data, ip: request.ip });
    reply.setCookie(SESSION_COOKIE_NAME, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: request.protocol === 'https',
      maxAge: DEFAULT_SESSION_TTL_SECONDS,
    });
    return { data: result.account };
  });

  app.get('/api/userinfo', async (request) => {
    return currentAccountResponseSchema.parse({ data: request.currentAccount });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      await options.service.logout(hashSessionToken(token), options.now?.() ?? new Date());
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });
}
