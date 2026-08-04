import { z } from 'zod';

export const apiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        requestId: z.string(),
        // 可选的补充说明：面向运营的具体原因，由界面逐条展示。
        details: z.array(z.string()).optional(),
      })
      .strict(),
  })
  .strict();
