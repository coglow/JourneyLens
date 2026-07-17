import { z } from 'zod';

export const PAGE_SIZES = [10, 20, 50] as const;

const positivePageSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

const pageQuerySchema = z
  .union([
    positivePageSchema,
    z
      .string()
      .regex(/^[1-9]\d*$/)
      .transform(Number)
      .pipe(positivePageSchema),
  ])
  .default(1);

const pageSizeSchema = z.union([
  z.literal(PAGE_SIZES[0]),
  z.literal(PAGE_SIZES[1]),
  z.literal(PAGE_SIZES[2]),
]);

const pageSizeQuerySchema = z
  .union([
    pageSizeSchema,
    z
      .string()
      .regex(/^(10|20|50)$/)
      .transform(Number)
      .pipe(pageSizeSchema),
  ])
  .default(PAGE_SIZES[0]);

export const paginationQuerySchema = z
  .object({ page: pageQuerySchema, pageSize: pageSizeQuerySchema })
  .strict();

export const pageMetadataSchema = z
  .object({
    page: z.number().int().min(1),
    pageSize: pageSizeSchema,
    total: z.number().int().min(0),
  })
  .strict();

export function paginatedListSchema<TItem extends z.ZodType>(itemSchema: TItem) {
  return z.object({ data: z.array(itemSchema), page: pageMetadataSchema }).strict();
}

export type PageMetadata = z.infer<typeof pageMetadataSchema>;
export type PaginatedList<TItem> = { data: TItem[]; page: PageMetadata };
