import { localizeError, type ErrorCode } from '@bvc/contracts';
import { createClient } from '@/lib/supabase/server';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const locale = body.locale === 'en' || body.locale === 'ar' ? body.locale : 'fr';
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return Response.json(
      { code: 'UNAUTHENTICATED', message: localizeError({ code: 'UNAUTHENTICATED' }, locale) },
      { status: 401 },
    );
  const { data, error } = await supabase.rpc('confirm_transaction_import', { p_import_id: id });
  if (error) {
    const allowed: ErrorCode[] = [
      'FORBIDDEN_PORTFOLIO',
      'IMPORT_NOT_CONFIRMABLE',
      'INSUFFICIENT_CASH',
      'INSUFFICIENT_HOLDINGS',
    ];
    const code = allowed.includes(error.message as ErrorCode)
      ? (error.message as ErrorCode)
      : 'INTERNAL_FAILURE';
    return Response.json(
      { code, message: localizeError({ code }, locale) },
      { status: code === 'FORBIDDEN_PORTFOLIO' ? 403 : 409 },
    );
  }
  if (data?.status === 'failed') {
    const code = data.failureCode as ErrorCode;
    return Response.json(
      { importId: id, ...data, message: localizeError({ code, row: data.failedRow }, locale) },
      { status: 409 },
    );
  }
  return Response.json({ importId: id, ...data });
}
