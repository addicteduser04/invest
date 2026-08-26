import { localizeError, reversalInputSchema, type ErrorCode } from '@bvc/contracts';
import { createClient } from '@/lib/supabase/server';

const allowedCodes: ErrorCode[] = [
  'FORBIDDEN_PORTFOLIO',
  'TRANSACTION_NOT_FOUND',
  'ALREADY_REVERSED',
  'REVERSAL_OF_REVERSAL_PROHIBITED',
  'REVERSAL_INSUFFICIENT_CASH',
  'REVERSAL_INSUFFICIENT_HOLDINGS',
  'INVALID_REVERSAL_REASON',
  'INVALID_REVERSAL_IDEMPOTENCY_REFERENCE',
  'INVALID_REPLACEMENT',
  'DUPLICATE_REVERSAL_IDEMPOTENCY_REFERENCE',
  'REVERSAL_CONFLICT',
  'REPLACEMENT_FAILURE',
];

const statusFor = (code: ErrorCode) => {
  if (code === 'FORBIDDEN_PORTFOLIO') return 403;
  if (code === 'TRANSACTION_NOT_FOUND') return 404;
  if (code === 'ALREADY_REVERSED' || code === 'REVERSAL_CONFLICT') return 409;
  return 422;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ portfolioId: string; transactionId: string }> },
) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = reversalInputSchema.safeParse(body);
  const locale =
    body && typeof body === 'object' && 'locale' in body && body.locale === 'ar' ? 'ar' : 'fr';
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return Response.json(
      { code: 'UNAUTHENTICATED', message: localizeError({ code: 'UNAUTHENTICATED' }, locale) },
      { status: 401 },
    );
  if (!parsed.success) {
    const reasonIssue = parsed.error.issues.some((issue) => issue.path[0] === 'reason');
    const code: ErrorCode = reasonIssue ? 'INVALID_REVERSAL_REASON' : 'INVALID_REPLACEMENT';
    return Response.json({ code, message: localizeError({ code }, locale) }, { status: 422 });
  }
  const { portfolioId, transactionId } = await params;
  const { data, error } = await supabase.rpc('reverse_transaction', {
    p_portfolio_id: portfolioId,
    p_original_transaction_id: transactionId,
    p_reason: parsed.data.reason,
    p_idempotency_reference: parsed.data.idempotencyReference,
    p_replacement: parsed.data.replacement ?? null,
  });
  if (error) {
    const code = allowedCodes.includes(error.message as ErrorCode)
      ? (error.message as ErrorCode)
      : 'INTERNAL_FAILURE';
    return Response.json(
      { code, message: localizeError({ code }, parsed.data.locale) },
      { status: code === 'INTERNAL_FAILURE' ? 500 : statusFor(code) },
    );
  }
  return Response.json(data);
}
