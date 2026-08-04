/** DeepSeek 的 OpenAI 兼容地址；只保留协议、域名和可选前缀，不拼接路径。 */
export const DEFAULT_AI_DRAFT_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_AI_DRAFT_MODEL = 'deepseek-v4-flash';

export interface AiDraftModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * AI 起草的模型配置：密钥只放在服务端环境变量里，不进入 Web 配置或数据库。
 * 未配置密钥时返回 undefined，生成接口据此提示暂不可用；手工编排不受影响。
 */
export function readAiDraftConfig(
  env: Record<string, string | undefined>,
): AiDraftModelConfig | undefined {
  const apiKey = env.AI_DRAFT_API_KEY?.trim();
  if (apiKey === undefined || apiKey === '') return undefined;

  const baseUrl = (env.AI_DRAFT_BASE_URL?.trim() || DEFAULT_AI_DRAFT_BASE_URL).replace(/\/+$/, '');
  const model = env.AI_DRAFT_MODEL?.trim() || DEFAULT_AI_DRAFT_MODEL;
  return { apiKey, baseUrl, model };
}
