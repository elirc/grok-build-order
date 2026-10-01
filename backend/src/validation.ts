import { z } from 'zod';
export const idSchema = z.string().trim().min(1).max(100);
const price = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, 'Use a positive decimal string with at most two decimal places.')
  .refine(value => Number(value) > 0, 'Price must be positive.');
export const productSchema = z.object({ name: z.string().trim().min(1).max(120), price, stock: z.number().int().min(0).max(2_000_000_000) }).strict();
export const productUpdateSchema = productSchema.extend({ version: z.number().int().positive() }).strict();
export const versionSchema = z.object({ version: z.number().int().positive() }).strict();
export const orderSchema = z.object({
  userId: z.string().trim().min(1).max(100),
  items: z.array(z.object({ productId: idSchema, quantity: z.number().int().min(1).max(10_000) }).strict()).min(1).max(50),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>();
  value.items.forEach((item, index) => {
    if (ids.has(item.productId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['items', index, 'productId'], message: 'Each product must appear only once.' });
    ids.add(item.productId);
  });
});
export const statusSchema = z.object({ status: z.enum(['CANCELLED', 'FULFILLED']) }).strict();
const integerQuery = z.string().regex(/^\d+$/, 'Use a non-negative integer.').transform(Number);
export const pageSchema = z.object({ limit: integerQuery.refine(value => value >= 1 && value <= 100).default('50'), offset: integerQuery.refine(value => value <= 100_000).default('0') }).strict();
export type ProductInput = z.infer<typeof productSchema>;
export type ProductUpdate = z.infer<typeof productUpdateSchema>;
export type OrderInput = z.infer<typeof orderSchema>;
export type PageInput = z.infer<typeof pageSchema>;
