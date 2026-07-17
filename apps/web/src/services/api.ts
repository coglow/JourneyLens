import axios, { type AxiosRequestConfig } from 'axios';
import { apiErrorResponseSchema } from '@journeylens/shared';

const DEFAULT_TIMEOUT_MS = 15_000;

interface ApiErrorOptions extends ErrorOptions {
  requestId?: string;
}

export class ApiError extends Error {
  readonly requestId: string | undefined;

  constructor(
    readonly status: number | undefined,
    readonly code: string,
    message: string,
    options?: ApiErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApiError';
    this.requestId = options?.requestId;
  }
}

export const apiClient = axios.create({
  baseURL: '/api',
  timeout: DEFAULT_TIMEOUT_MS,
});

apiClient.interceptors.request.use((config) => {
  config.headers.set('Accept', 'application/json');
  return config;
});

function fallbackMessage(status: number): string {
  if (status === 401) return '登录已失效，请重新登录';
  if (status === 403) return '没有执行该操作的权限';
  if (status === 404) return '请求的内容不存在';
  if (status >= 500) return '服务暂时不可用，请稍后重试';
  return '请求未能完成，请稍后重试';
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError(error)) {
    if (error.response !== undefined) {
      const parsed = apiErrorResponseSchema.safeParse(error.response.data);
      if (parsed.success) {
        return new ApiError(
          error.response.status,
          parsed.data.error.code,
          parsed.data.error.message,
          { requestId: parsed.data.error.requestId },
        );
      }
      return new ApiError(
        error.response.status,
        'REQUEST_FAILED',
        fallbackMessage(error.response.status),
      );
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new ApiError(undefined, 'TIMEOUT', '请求超时，请稍后重试');
    }
    return new ApiError(undefined, 'NETWORK_ERROR', '无法连接服务器，请稍后重试');
  }

  return new ApiError(undefined, 'UNKNOWN_ERROR', '服务暂时不可用，请稍后重试', {
    cause: error,
  });
}

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    // 主动取消交给 Query 的取消流程处理，不转换成普通失败。
    if (axios.isCancel(error)) return Promise.reject(error);
    return Promise.reject(toApiError(error));
  },
);

type ResponseSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

/** JSON 接口入口：地址、方法、参数由 service 提供，返回 schema 校验后的响应体。 */
export async function request<T>(
  config: AxiosRequestConfig,
  schema: ResponseSchema<T>,
): Promise<T> {
  const response = await apiClient.request<unknown>(config);
  const parsed = schema.safeParse(response.data);
  if (!parsed.success) {
    throw new ApiError(response.status, 'INVALID_RESPONSE', '服务暂时不可用，请稍后重试');
  }
  return parsed.data;
}

/** 无响应体的接口入口：当前用于退出登录和删除活动的 204 响应。 */
export async function requestVoid(config: AxiosRequestConfig): Promise<void> {
  const response = await apiClient.request<unknown>(config);
  if (response.status !== 204) {
    throw new ApiError(response.status, 'INVALID_RESPONSE', '服务暂时不可用，请稍后重试');
  }
}

export function getApiErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : '服务暂时不可用，请稍后重试';
}

/** 写入超时时结果不明确，提示调用方核实，而不是重复提交。 */
export function getWriteErrorMessage(error: unknown): string {
  return error instanceof ApiError && error.code === 'TIMEOUT'
    ? '请求超时，操作结果未确认，请稍后核实'
    : getApiErrorMessage(error);
}

export function isSessionExpired(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401;
}
