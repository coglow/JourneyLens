import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors.js';

export function registerRequestSecurity(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] ?? request.url;
    if (!path.startsWith('/api/')) return;
    // CSRF 防护：对 /api/* 写请求强制同源 Origin 校验。
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (typeof origin !== 'string') {
      throw new ApiError(403, 'INVALID_ORIGIN', '请求来源无效');
    }

    let originValue: string;
    let requestOrigin: string;
    try {
      originValue = new URL(origin).origin;
      requestOrigin = new URL(`${request.protocol}://${request.host}`).origin;
    } catch {
      throw new ApiError(403, 'INVALID_ORIGIN', '请求来源无效');
    }
    if (originValue !== requestOrigin) {
      throw new ApiError(403, 'INVALID_ORIGIN', '请求来源无效');
    }

    // 防 CSRF：业务写接口都要求登录 Cookie，跨站请求带不上（SameSite=Lax 挡住了）；而伪造 login 会把用户登进攻击者的账号，所以必须在这里拦。
    // 攻击者跨站请求伪造，Content-Type 只能是表单、纯文本等几种（浏览器限制）， 发不出 application/json；强制 JSON 就拒掉了这类请求
    if (path === '/api/auth/login') {
      const contentType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
      if (contentType !== 'application/json') {
        throw new ApiError(415, 'JSON_REQUIRED', '登录请求必须使用 application/json');
      }
    }
  });
}
