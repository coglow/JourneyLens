import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { campaignListResponseSchema } from '@journeylens/shared';
import {
  ApiError,
  apiClient,
  getApiErrorMessage,
  isSessionExpired,
  request,
  requestVoid,
} from './api';

const mock = new MockAdapter(apiClient);

const passthroughSchema = {
  safeParse: (value: unknown) => ({ success: true as const, data: value }),
};

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('请求本应失败');
    },
    (error: unknown) => error,
  );
}

beforeEach(() => mock.reset());

afterEach(() => mock.reset());

describe('请求客户端', () => {
  it('使用统一地址前缀、查询参数，并返回校验后的响应体', async () => {
    mock.onGet('/campaigns').reply(200, {
      data: [],
      page: { page: 1, pageSize: 10, total: 0 },
    });

    const body = await request(
      { url: '/campaigns', method: 'GET', params: { q: 'spring', page: 2 } },
      campaignListResponseSchema,
    );

    expect(body.page.total).toBe(0);
    expect(mock.history.get[0]?.url).toBe('/campaigns');
    expect(mock.history.get[0]?.baseURL).toBe('/api');
    expect(mock.history.get[0]?.params).toEqual({ q: 'spring', page: 2 });
    expect(mock.history.get[0]?.withCredentials).toBeFalsy();
  });

  it('响应格式不符合约定时失败，不返回假数据', async () => {
    mock.onGet('/campaigns').reply(200, { data: 'invalid' });

    const error = await captureError(
      request({ url: '/campaigns', method: 'GET' }, campaignListResponseSchema),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
    expect(getApiErrorMessage(error)).toBe('服务暂时不可用，请稍后重试');
  });

  it('服务端错误保留实际状态、错误码、文案与请求 ID', async () => {
    mock.onGet('/campaigns/1').reply(404, {
      error: { code: 'NOT_FOUND', message: '活动不存在', requestId: 'req-404' },
    });

    const error = await captureError(
      request({ url: '/campaigns/1', method: 'GET' }, passthroughSchema),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: '活动不存在',
      requestId: 'req-404',
    });
    expect(isSessionExpired(error)).toBe(false);
  });

  it('保留错误详情与服务端给出的等待秒数', async () => {
    mock.onPost('/journeys/1/ai-draft').reply(
      429,
      {
        error: {
          code: 'AI_DRAFT_RATE_LIMITED',
          message: '起草请求过于频繁，请稍后再试',
          requestId: 'req-429',
          details: ['「短信订阅判断」：请选择“是”或“否”'],
        },
      },
      { 'retry-after': '900' },
    );

    const error = await captureError(
      request({ url: '/journeys/1/ai-draft', method: 'POST' }, passthroughSchema),
    );

    expect(error).toMatchObject({
      status: 429,
      code: 'AI_DRAFT_RATE_LIMITED',
      retryAfterSeconds: 900,
      details: ['「短信订阅判断」：请选择“是”或“否”'],
    });
  });

  it('缺少 Retry-After 时不猜等待秒数', async () => {
    mock.onPost('/journeys/1/ai-draft').reply(429, {
      error: {
        code: 'AI_DRAFT_RATE_LIMITED',
        message: '请求过于频繁，请 60 秒后重试',
        requestId: 'req-429',
      },
    });

    const error = await captureError(
      request({ url: '/journeys/1/ai-draft', method: 'POST' }, passthroughSchema),
    );

    expect(error).toMatchObject({ status: 429, retryAfterSeconds: undefined });
  });

  it('错误响应缺少请求标识时使用公开兜底文案', async () => {
    mock.onGet('/campaigns/1').reply(500, {
      error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' },
    });

    const error = await captureError(
      request({ url: '/campaigns/1', method: 'GET' }, passthroughSchema),
    );

    expect(error).toMatchObject({
      status: 500,
      code: 'REQUEST_FAILED',
      message: '服务暂时不可用，请稍后重试',
      requestId: undefined,
    });
  });

  it('登录失效保留 401，供认证接入识别', async () => {
    mock.onGet('/userinfo').reply(401, {
      error: { code: 'AUTH_REQUIRED', message: '登录已失效', requestId: 'req-401' },
    });

    const error = await captureError(
      request({ url: '/userinfo', method: 'GET' }, passthroughSchema),
    );

    expect(isSessionExpired(error)).toBe(true);
  });

  it('服务端响应无法解析时保留状态并使用公开兜底文案', async () => {
    mock.onGet('/campaigns').reply(502, 'Bad Gateway');

    const error = await captureError(
      request({ url: '/campaigns', method: 'GET' }, passthroughSchema),
    );

    expect(error).toMatchObject({ status: 502, code: 'REQUEST_FAILED' });
    expect(getApiErrorMessage(error)).toBe('服务暂时不可用，请稍后重试');
  });

  it('网络不可达时不伪造状态', async () => {
    mock.onGet('/campaigns').networkErrorOnce();

    const error = await captureError(
      request({ url: '/campaigns', method: 'GET' }, passthroughSchema),
    );

    expect(error).toMatchObject({
      status: undefined,
      code: 'NETWORK_ERROR',
      requestId: undefined,
    });
    expect(getApiErrorMessage(error)).toBe('无法连接服务器，请稍后重试');
  });

  it('超时提示请求超时', async () => {
    mock.onGet('/campaigns').timeoutOnce();

    const error = await captureError(
      request({ url: '/campaigns', method: 'GET' }, passthroughSchema),
    );

    expect(error).toMatchObject({ status: undefined, code: 'TIMEOUT' });
    expect(getApiErrorMessage(error)).toBe('请求超时，请稍后重试');
  });

  it('主动取消保持为取消结果，不转换成普通失败', async () => {
    const controller = new AbortController();
    controller.abort();
    mock.onGet('/campaigns').reply(200, {});

    const error = await captureError(
      request({ url: '/campaigns', method: 'GET', signal: controller.signal }, passthroughSchema),
    );

    expect(axios.isCancel(error)).toBe(true);
    expect(error).not.toBeInstanceOf(ApiError);
  });

  it('无响应体接口只接受 204', async () => {
    mock.onDelete('/campaigns/1').reply(204);
    await expect(requestVoid({ url: '/campaigns/1', method: 'DELETE' })).resolves.toBeUndefined();

    mock.onPost('/auth/logout').reply(200, {});
    const error = await captureError(requestVoid({ url: '/auth/logout', method: 'POST' }));
    expect(error).toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
  });
});
