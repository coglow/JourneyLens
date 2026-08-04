import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import type { AiDraftModelConfig } from '../../config.js';
import { ApiError } from '../../errors.js';
import type { AiDraftPromptMessage } from './ai-draft-prompt.js';

/** 服务端自身的等待上限：到点中止本次请求，不自动重新调用。 */
export const AI_DRAFT_MODEL_TIMEOUT_MS = 60_000;
/** 包含服务商外层包装的总响应上限，读取时计数，超限立即停止。 */
export const AI_DRAFT_RESPONSE_MAX_BYTES = 256 * 1024;

export type AiDraftModelCall = (
  config: AiDraftModelConfig,
  messages: readonly AiDraftPromptMessage[],
  log?: Pick<FastifyBaseLogger, 'info' | 'warn'>,
) => Promise<string>;

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string(),
        message: z.object({ content: z.string().nullish() }),
      }),
    )
    .min(1, '模型没有返回任何结果'),
});

function timeoutError(): ApiError {
  return new ApiError(504, 'AI_DRAFT_TIMEOUT', '生成耗时较长，本次未取得方案，请稍后重试');
}

function unavailableError(): ApiError {
  // 供应商的状态、错误体和原始响应都不进入界面，只给统一的可重试提示。
  return new ApiError(503, 'AI_DRAFT_UNAVAILABLE', 'AI 起草暂不可用，请稍后再试');
}

function invalidOutputError(): ApiError {
  return new ApiError(
    502,
    'AI_DRAFT_INVALID_OUTPUT',
    '本次方案未通过流程检查，请重新生成或调整描述',
  );
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/** 边读边计数：超过上限就不再读取剩余内容，避免大响应占满内存。 */
async function readBodyWithLimit(response: Response, limitBytes: number): Promise<string> {
  const body = response.body;
  if (body === null) return '';

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limitBytes) {
        await reader.cancel();
        throw unavailableError();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw isTimeout(error) ? timeoutError() : unavailableError();
  }
}

/**
 * 单次模型请求：使用 DeepSeek 的 OpenAI 兼容接口，要求返回 json 对象。
 */
export async function callAiDraftModel(
  config: AiDraftModelConfig,
  messages: readonly AiDraftPromptMessage[],
  log?: Pick<FastifyBaseLogger, 'info' | 'warn'>,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(AI_DRAFT_MODEL_TIMEOUT_MS),
    });
  } catch (error) {
    log?.warn(
      { stage: 'model-request', model: config.model, timeout: isTimeout(error) },
      'AI 起草模型请求失败',
    );
    throw isTimeout(error) ? timeoutError() : unavailableError();
  }

  if (!response.ok) {
    log?.warn(
      { stage: 'model-http', model: config.model, statusCode: response.status },
      'AI 起草服务拒绝请求',
    );
    await response.body?.cancel();
    throw unavailableError();
  }

  const text = await readBodyWithLimit(response, AI_DRAFT_RESPONSE_MAX_BYTES);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    log?.warn({ stage: 'model-envelope-json', model: config.model }, 'AI 起草响应不是有效 JSON');
    throw invalidOutputError();
  }

  const parsed = completionSchema.safeParse(payload);
  if (!parsed.success) {
    log?.warn({ stage: 'model-envelope', model: config.model }, 'AI 起草响应缺少必要字段');
    throw unavailableError();
  }

  const choice = parsed.data.choices[0]!;
  const content = choice.message.content ?? '';
  const finishReason = choice.finish_reason;
  // 结束原因随请求编号进入日志，避免将截断或空内容误当作普通流程错误。
  log?.info(
    { model: config.model, finishReason, contentLength: content.length },
    'AI 起草模型已返回',
  );
  if (finishReason !== 'stop' || content.trim() === '') {
    log?.warn(
      { stage: 'model-content', model: config.model, finishReason, empty: content.trim() === '' },
      'AI 起草模型未返回完整内容',
    );
    throw invalidOutputError();
  }
  return content;
}
