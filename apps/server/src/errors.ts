export interface ApiErrorOptions {
  /** 429 等需要告知等待时间的响应会带上 Retry-After。 */
  retryAfterSeconds?: number;
  /** 面向运营的原因说明 */
  details?: readonly string[];
}

export class ApiError extends Error {
  readonly retryAfterSeconds: number | undefined;
  readonly details: readonly string[] | undefined;

  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    options: ApiErrorOptions = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details;
  }
}
