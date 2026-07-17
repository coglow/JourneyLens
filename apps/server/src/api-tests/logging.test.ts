import { describe, expect, it } from 'vitest';
import { login, makeApp, signedInCookie } from '../test-support/harness.js';

function collectLogs() {
  const lines: string[] = [];
  const stream = {
    write(message: string) {
      lines.push(message);
    },
  };
  return { lines, logger: { stream } };
}

function terminalRecords(lines: string[]): Array<Record<string, unknown>> {
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((record) => typeof record.route === 'string');
}

describe('请求日志', () => {
  it('成功请求输出一条终态记录，沿用合法请求 ID 且不记录查询参数', async () => {
    const logs = collectLogs();
    const { app } = makeApp('active', logs.logger);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health/live?secret-query=do-not-log',
        headers: { 'x-request-id': 'client-request-1' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-request-id']).toBe('client-request-1');

      const records = terminalRecords(logs.lines);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        level: 30,
        requestId: 'client-request-1',
        method: 'GET',
        route: '/health/live',
        statusCode: 200,
        msg: '请求完成',
      });
      expect(typeof records[0]?.durationMs).toBe('number');
      expect(logs.lines.join('\n')).not.toContain('secret-query');
    } finally {
      await app.close();
    }
  });

  it('无效请求 ID 被替换为 UUID', async () => {
    const logs = collectLogs();
    const { app } = makeApp('active', logs.logger);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { 'x-request-id': 'bad id with spaces' },
      });
      const requestId = String(response.headers['x-request-id']);
      expect(requestId).not.toBe('bad id with spaces');
      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      const records = terminalRecords(logs.lines);
      expect(records).toHaveLength(1);
      expect(records[0]?.requestId).toBe(requestId);
    } finally {
      await app.close();
    }
  });

  it('4xx 输出 warn 级别，且不写入密码、邮箱或 Cookie', async () => {
    const logs = collectLogs();
    const { app } = makeApp('active', logs.logger);
    try {
      const response = await login(app, 'operator@example.com', 'wrong-password');
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: { code: 'INVALID_CREDENTIALS', message: '邮箱或密码不正确' },
      });
      expect(response.headers['x-request-id']).toBe(response.json().error.requestId);

      const records = terminalRecords(logs.lines);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        level: 40,
        method: 'POST',
        route: '/api/auth/login',
        statusCode: 401,
        errorCode: 'INVALID_CREDENTIALS',
        msg: '请求失败',
      });

      const output = logs.lines.join('\n');
      expect(output).not.toContain('wrong-password');
      expect(output).not.toContain('operator@example.com');
      expect(output).not.toContain('journeylens_session');
    } finally {
      await app.close();
    }
  });

  it('非业务 4xx 也带请求 ID，并记录安全的错误类型', async () => {
    const logs = collectLogs();
    const { app } = makeApp('active', logs.logger);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          host: 'localhost',
          origin: 'http://localhost',
          'content-type': 'application/json',
        },
        payload: '{"email":',
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: 'BAD_REQUEST', message: '请求内容无效' },
      });
      expect(response.headers['x-request-id']).toBe(response.json().error.requestId);

      const records = terminalRecords(logs.lines);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        level: 40,
        method: 'POST',
        route: '/api/auth/login',
        statusCode: 400,
        msg: '请求失败',
      });
      expect(typeof records[0]?.errorType).toBe('string');
    } finally {
      await app.close();
    }
  });

  it('未登录未知接口返回 401，登录后返回统一 404，且不记录查询参数和 Cookie', async () => {
    const logs = collectLogs();
    const { app } = makeApp('active', logs.logger);
    try {
      const anonymous = await app.inject({
        method: 'GET',
        url: '/api/missing-route?secret-query=do-not-log',
      });
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
      expect(anonymous.headers['x-request-id']).toBe(anonymous.json().error.requestId);

      const cookie = await signedInCookie(app);
      logs.lines.length = 0;

      const missing = await app.inject({
        method: 'GET',
        url: '/api/missing-route?secret-query=do-not-log',
        headers: { cookie },
      });
      const requestId = String(missing.headers['x-request-id']);
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({
        error: { code: 'NOT_FOUND', message: '请求的内容不存在' },
      });
      expect(missing.json().error.requestId).toBe(requestId);

      const records = terminalRecords(logs.lines);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        level: 40,
        requestId,
        method: 'GET',
        route: 'unmatched',
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        msg: '请求失败',
      });

      const output = logs.lines.join('\n');
      expect(output).not.toContain('secret-query');
      expect(output).not.toContain(cookie);
    } finally {
      await app.close();
    }
  });

  it('5xx 输出 error 级别，且不写入异常正文', async () => {
    const logs = collectLogs();
    const { app, campaignModel } = makeApp('active', logs.logger);
    try {
      const cookie = await signedInCookie(app);
      logs.lines.length = 0;
      campaignModel.findMany.mockRejectedValueOnce(new Error('database secret detail'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/campaigns',
        headers: { cookie },
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' },
      });
      expect(response.headers['x-request-id']).toBe(response.json().error.requestId);

      const records = terminalRecords(logs.lines);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        level: 50,
        method: 'GET',
        route: '/api/campaigns',
        statusCode: 500,
        errorType: 'Error',
        msg: '请求失败',
      });
      expect(logs.lines.join('\n')).not.toContain('database secret detail');
    } finally {
      await app.close();
    }
  });
});
