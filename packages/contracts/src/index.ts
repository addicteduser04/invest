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
