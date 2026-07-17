import { z } from 'zod';

export const loginRequestSchema = z
  .object({
    email: z.email().min(1).max(320),
    password: z.string().min(1),
  })
  .strict();

export const currentAccountSchema = z
  .object({
    id: z.uuid(),
    email: z.email().min(1).max(320),
    displayName: z.string().min(1).max(120),
  })
  .strict();

export const currentAccountResponseSchema = z.object({ data: currentAccountSchema }).strict();

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type CurrentAccount = z.infer<typeof currentAccountSchema>;
