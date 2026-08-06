import { localizeError, type ErrorCode } from '@bvc/contracts';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const locale = body.locale === 'ar' ? 'ar' : 'fr';
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return Response.json(
      { code: 'UNAUTHENTICATED', message: localizeError({ code: 'UNAUTHENTICATED' }, locale) },
      { status: 401 },
    );
  const { error } = await supabase.rpc('supersede_transaction_import', { p_import_id: id });
  if (error) {
    const allowed: ErrorCode[] = [
      'FORBIDDEN_PORTFOLIO',
      'CONFIRMED_IMPORT_IMMUTABLE',
      'IMPORT_NOT_CONFIRMABLE',
    ];
    const code = allowed.includes(error.message as ErrorCode)
      ? (error.message as ErrorCode)
      : 'INTERNAL_FAILURE';
    return Response.json(
      { code, message: localizeError({ code }, locale) },
      { status: code === 'FORBIDDEN_PORTFOLIO' ? 403 : 409 },
    );
  }
  return Response.json({ importId: id, status: 'superseded' });
}
