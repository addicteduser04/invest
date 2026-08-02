import { z } from 'zod';
export const localeSchema = z.enum(['fr', 'ar']);
export const transactionInputSchema = z.object({
  portfolioId: z.uuid(),
  type: z.enum(['deposit', 'buy']),
  securityId: z.uuid().optional(),
  settlementDate: z.iso.date(),
  quantity: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  unitPrice: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  idempotencyKey: z.string().min(16).max(128),
});
