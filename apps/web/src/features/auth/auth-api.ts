import {
  apiErrorResponseSchema,
  currentAccountResponseSchema,
  type CurrentAccount,
  type LoginRequest,
} from '@journeylens/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getApiErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : '无法连接服务器，请稍后重试';
}

async function readError(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = apiErrorResponseSchema.safeParse(body);
  if (parsed.success) {
    return new ApiError(response.status, parsed.data.error.code, parsed.data.error.message);
  }
  return new ApiError(response.status, 'REQUEST_FAILED', '服务暂时不可用，请稍后重试');
}

async function readAccount(response: Response): Promise<CurrentAccount> {
  if (!response.ok) throw await readError(response);
  const body: unknown = await response.json();
  const parsed = currentAccountResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('API 账号响应格式无效');
  return parsed.data.data;
}

export async function getCurrentAccount(): Promise<CurrentAccount> {
  const response = await fetch('/api/userinfo', { credentials: 'same-origin' });
  return readAccount(response);
}

export async function login(values: LoginRequest): Promise<CurrentAccount> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(values),
  });
  return readAccount(response);
}

export async function logout(): Promise<void> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (!response.ok) throw await readError(response);
}
