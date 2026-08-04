import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../errors.js';
import { callAiDraftModel, type AiDraftModelCall } from './ai-draft-model.js';
import type { AiDraftPromptMessage } from './ai-draft-prompt.js';

const config = {
  apiKey: 'secret-key',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
};
const messages: AiDraftPromptMessage[] = [
  { role: 'system', content: '系统规则' },
  { role: 'user', content: '运营描述' },
];

function stubFetch(impl: unknown): ReturnType<typeof vi.fn> {
  const spy = vi.fn(impl as AiDraftModelCall);
  vi.stubGlobal('fetch', spy);
  return spy;
}

function completion(content: string | null, finishReason = 'stop'): Response {
  return new Response(
    JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content } }] }),
    { status: 200 },
  );
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('预期请求失败，但调用成功返回');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callAiDraftModel', () => {
  it('按 OpenAI 兼容格式请求并返回第一条候选正文', async () => {
    const fetchSpy = stubFetch(async () =>
      completion('{"status":"unsupported","reason":"当前不支持自动发券"}'),
    );

    const content = await callAiDraftModel(config, messages);

    expect(content).toBe('{"status":"unsupported","reason":"当前不支持自动发券"}');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret-key');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: unknown[];
      response_format: unknown;
    };
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.messages).toHaveLength(2);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it.each([null, '', '   '])('空内容 %j 记录原因并作为无效输出拒绝', async (content) => {
    const log = { info: vi.fn(), warn: vi.fn() };
    stubFetch(async () => completion(content));
    expect(await captureError(() => callAiDraftModel(config, messages, log))).toMatchObject({
      statusCode: 502,
      code: 'AI_DRAFT_INVALID_OUTPUT',
    });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'model-content',
        finishReason: 'stop',
        empty: true,
      }),
      'AI 起草模型未返回完整内容',
    );
  });

  it('记录模型结束原因，截断输出即使是合法 JSON 也不能继续使用', async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const content = '{"status":"unsupported","reason":"原始正文不进入日志"}';
    stubFetch(async () => completion(content, 'length'));
    expect(await captureError(() => callAiDraftModel(config, messages, log))).toMatchObject({
      statusCode: 502,
      code: 'AI_DRAFT_INVALID_OUTPUT',
    });
    expect(log.info).toHaveBeenCalledWith(
      {
        model: 'deepseek-v4-flash',
        finishReason: 'length',
        contentLength: content.length,
      },
      'AI 起草模型已返回',
    );
    expect(JSON.stringify([log.info.mock.calls, log.warn.mock.calls])).not.toContain(
      '原始正文不进入日志',
    );
    expect(JSON.stringify([log.info.mock.calls, log.warn.mock.calls])).not.toContain('secret-key');
  });

  it('服务端拒绝、断网和超时分别给出可重试的提示，且不暴露原始错误', async () => {
    stubFetch(async () => new Response('{"error":"invalid key"}', { status: 401 }));
    expect(await captureError(() => callAiDraftModel(config, messages))).toMatchObject({
      statusCode: 503,
      code: 'AI_DRAFT_UNAVAILABLE',
      message: 'AI 起草暂不可用，请稍后再试',
    });

    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await captureError(() => callAiDraftModel(config, messages))).toMatchObject({
      statusCode: 503,
      code: 'AI_DRAFT_UNAVAILABLE',
    });

    stubFetch(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    expect(await captureError(() => callAiDraftModel(config, messages))).toMatchObject({
      statusCode: 504,
      code: 'AI_DRAFT_TIMEOUT',
    });
  });

  it('响应不是 json 或缺少候选时按无效输出或不可用处理', async () => {
    stubFetch(async () => new Response('不是 json', { status: 200 }));
    expect(await captureError(() => callAiDraftModel(config, messages))).toMatchObject({
      statusCode: 502,
      code: 'AI_DRAFT_INVALID_OUTPUT',
    });

    stubFetch(async () => new Response(JSON.stringify({ error: 'server error' }), { status: 200 }));
    expect(await captureError(() => callAiDraftModel(config, messages))).toMatchObject({
      statusCode: 503,
      code: 'AI_DRAFT_UNAVAILABLE',
    });
  });

  it('总响应超过上限时停止读取并拒绝', async () => {
    stubFetch(async () => completion('x'.repeat(300 * 1024)));

    const error = await captureError(() => callAiDraftModel(config, messages));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ statusCode: 503, code: 'AI_DRAFT_UNAVAILABLE' });
  });
});
