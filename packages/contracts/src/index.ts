import { z } from 'zod';
export const localeSchema = z.enum(['fr', 'ar']);
export type Locale = z.infer<typeof localeSchema>;
export const errorCodeSchema = z.enum([
  'UNAUTHENTICATED',
  'FORBIDDEN_PORTFOLIO',
  'INVALID_TRANSACTION_TYPE',
  'INVALID_DECIMAL',
  'INVALID_DATE',
  'UNKNOWN_SECURITY',
  'INSUFFICIENT_CASH',
  'INSUFFICIENT_HOLDINGS',
  'DUPLICATE_IDEMPOTENCY_KEY',
  'DUPLICATE_IMPORT',
  'DUPLICATE_ROW',
  'DUPLICATE_EXTERNAL_REFERENCE',
  'EXISTING_TRANSACTION',
  'INVALID_FILE',
  'FILE_TOO_LARGE',
  'TOO_MANY_ROWS',
  'INVALID_MAPPING',
  'IMPORT_NOT_CONFIRMABLE',
  'CONFIRMED_IMPORT_IMMUTABLE',
  'IMPORT_VALIDATION_FAILED',
  'ALREADY_REVERSED',
  'TRANSACTION_NOT_FOUND',
  'REVERSAL_OF_REVERSAL_PROHIBITED',
  'REVERSAL_INSUFFICIENT_CASH',
  'REVERSAL_INSUFFICIENT_HOLDINGS',
  'INVALID_REVERSAL_REASON',
  'INVALID_REVERSAL_IDEMPOTENCY_REFERENCE',
  'INVALID_REPLACEMENT',
  'DUPLICATE_REVERSAL_IDEMPOTENCY_REFERENCE',
  'REVERSAL_CONFLICT',
  'REPLACEMENT_FAILURE',
  'RECALCULATION_PENDING',
  'MISSING_PRICE',
  'STALE_PRICE',
  'INTERNAL_FAILURE',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export interface AppError {
  code: ErrorCode;
  field?: string;
  row?: number;
}
const messages: Record<Locale, Record<ErrorCode, string>> = {
  fr: {
    UNAUTHENTICATED: 'Authentification requise.',
    FORBIDDEN_PORTFOLIO: 'Accès au portefeuille interdit.',
    INVALID_TRANSACTION_TYPE: 'Type d’opération invalide.',
    INVALID_DECIMAL: 'Valeur décimale invalide.',
    INVALID_DATE: 'Date invalide.',
    UNKNOWN_SECURITY: 'Titre inconnu.',
    INSUFFICIENT_CASH: 'Trésorerie insuffisante.',
    INSUFFICIENT_HOLDINGS: 'Quantité détenue insuffisante.',
    DUPLICATE_IDEMPOTENCY_KEY: 'Référence déjà utilisée.',
    DUPLICATE_IMPORT: 'Fichier déjà importé.',
    DUPLICATE_ROW: 'Ligne en double dans le fichier.',
    DUPLICATE_EXTERNAL_REFERENCE: 'Référence externe en double.',
    EXISTING_TRANSACTION: 'Opération déjà présente dans le portefeuille.',
    INVALID_FILE: 'Fichier CSV vide, mal formé ou non pris en charge.',
    FILE_TOO_LARGE: 'Le fichier dépasse la taille autorisée.',
    TOO_MANY_ROWS: 'Le fichier contient trop de lignes.',
    INVALID_MAPPING: 'La correspondance des colonnes est invalide.',
    IMPORT_NOT_CONFIRMABLE: 'Cet import ne peut pas être confirmé.',
    CONFIRMED_IMPORT_IMMUTABLE: 'Un import confirmé ne peut pas être remplacé.',
    IMPORT_VALIDATION_FAILED: 'L’import contient des erreurs.',
    ALREADY_REVERSED: 'Opération déjà annulée.',
    TRANSACTION_NOT_FOUND: 'Opération introuvable.',
    REVERSAL_OF_REVERSAL_PROHIBITED: 'Une contre-écriture ne peut pas être annulée.',
    REVERSAL_INSUFFICIENT_CASH: 'L’annulation créerait une trésorerie négative.',
    REVERSAL_INSUFFICIENT_HOLDINGS: 'L’annulation créerait une position négative.',
    INVALID_REVERSAL_REASON: 'Le motif d’annulation est obligatoire et doit être précis.',
    INVALID_REVERSAL_IDEMPOTENCY_REFERENCE: 'Référence de demande d’annulation invalide.',
    INVALID_REPLACEMENT: 'L’opération de remplacement est invalide.',
    DUPLICATE_REVERSAL_IDEMPOTENCY_REFERENCE: 'Cette référence appartient à une autre demande.',
    REVERSAL_CONFLICT: 'Une annulation concurrente a déjà été enregistrée.',
    REPLACEMENT_FAILURE: 'Le remplacement a échoué ; aucune annulation n’a été appliquée.',
    RECALCULATION_PENDING: 'Recalcul en attente.',
    MISSING_PRICE: 'Cours indisponible.',
    STALE_PRICE: 'Cours ancien.',
    INTERNAL_FAILURE: 'Erreur interne.',
  },
  ar: {
    UNAUTHENTICATED: 'المصادقة مطلوبة.',
    FORBIDDEN_PORTFOLIO: 'الوصول إلى المحفظة ممنوع.',
    INVALID_TRANSACTION_TYPE: 'نوع العملية غير صالح.',
    INVALID_DECIMAL: 'قيمة عشرية غير صالحة.',
    INVALID_DATE: 'التاريخ غير صالح.',
    UNKNOWN_SECURITY: 'السهم غير معروف.',
    INSUFFICIENT_CASH: 'السيولة غير كافية.',
    INSUFFICIENT_HOLDINGS: 'الكمية المملوكة غير كافية.',
    DUPLICATE_IDEMPOTENCY_KEY: 'المرجع مستخدم مسبقاً.',
    DUPLICATE_IMPORT: 'تم استيراد الملف مسبقاً.',
    DUPLICATE_ROW: 'يوجد صف مكرر في الملف.',
    DUPLICATE_EXTERNAL_REFERENCE: 'المرجع الخارجي مكرر.',
    EXISTING_TRANSACTION: 'العملية موجودة مسبقاً في المحفظة.',
    INVALID_FILE: 'ملف CSV فارغ أو تالف أو غير مدعوم.',
    FILE_TOO_LARGE: 'حجم الملف يتجاوز الحد المسموح.',
    TOO_MANY_ROWS: 'يحتوي الملف على عدد كبير من الصفوف.',
    INVALID_MAPPING: 'تعيين الأعمدة غير صالح.',
    IMPORT_NOT_CONFIRMABLE: 'لا يمكن تأكيد هذا الاستيراد.',
    CONFIRMED_IMPORT_IMMUTABLE: 'لا يمكن استبدال استيراد مؤكد.',
    IMPORT_VALIDATION_FAILED: 'يحتوي الاستيراد على أخطاء.',
    ALREADY_REVERSED: 'تم عكس العملية مسبقاً.',
    TRANSACTION_NOT_FOUND: 'العملية غير موجودة.',
    REVERSAL_OF_REVERSAL_PROHIBITED: 'لا يمكن عكس القيد العكسي.',
    REVERSAL_INSUFFICIENT_CASH: 'سيؤدي العكس إلى سيولة سالبة.',
    REVERSAL_INSUFFICIENT_HOLDINGS: 'سيؤدي العكس إلى مركز أسهم سالب.',
    INVALID_REVERSAL_REASON: 'سبب العكس إلزامي ويجب أن يكون واضحاً.',
    INVALID_REVERSAL_IDEMPOTENCY_REFERENCE: 'مرجع طلب العكس غير صالح.',
    INVALID_REPLACEMENT: 'عملية الاستبدال غير صالحة.',
    DUPLICATE_REVERSAL_IDEMPOTENCY_REFERENCE: 'هذا المرجع مرتبط بطلب آخر.',
    REVERSAL_CONFLICT: 'تم تسجيل عكس متزامن مسبقاً.',
    REPLACEMENT_FAILURE: 'فشل الاستبدال؛ لم يتم تطبيق أي عكس.',
    RECALCULATION_PENDING: 'إعادة الحساب قيد الانتظار.',
    MISSING_PRICE: 'السعر غير متاح.',
    STALE_PRICE: 'السعر قديم.',
    INTERNAL_FAILURE: 'خطأ داخلي.',
  },
};
export const localizeError = (error: AppError, locale: Locale) => messages[locale][error.code];
export const decimalSchema = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/)
  .max(64);
export const transactionInputSchema = z.object({
  portfolioId: z.uuid(),
  type: z.enum(['deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'fee', 'tax']),
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
  fees: decimalSchema.optional(),
  taxes: decimalSchema.optional(),
  currency: z.literal('MAD').default('MAD'),
  idempotencyKey: z.string().min(16).max(128),
});

export const reversalInputSchema = z.object({
  locale: localeSchema.default('fr'),
  reason: z.string().trim().min(8).max(1000),
  idempotencyReference: z.string().min(16).max(128),
  replacement: transactionInputSchema.omit({ portfolioId: true, idempotencyKey: true }).optional(),
});

export const portfolioStatePositionSchema = z.object({
  securityId: z.uuid(),
  quantity: decimalSchema,
  averageCost: decimalSchema,
  costBasis: decimalSchema,
  realizedGain: z.string().regex(/^-?\d+(?:\.\d+)?$/),
});
export const portfolioStateSchema = z.object({
  portfolioId: z.uuid(),
  asOf: z.iso.datetime({ offset: true }),
  cash: z.string().regex(/^-?\d+(?:\.\d+)?$/),
  realizedGain: z.string().regex(/^-?\d+(?:\.\d+)?$/),
  positions: z.array(portfolioStatePositionSchema),
  transactionCount: z.number().int().nonnegative(),
  lastTransactionId: z.uuid().nullable(),
  lastTransactionRecordedAt: z.iso.datetime({ offset: true }).nullable(),
  source: z.enum(['snapshot', 'replay']),
  ruleVersion: z.literal('average-cost-v1'),
});
export type PortfolioState = z.infer<typeof portfolioStateSchema>;
