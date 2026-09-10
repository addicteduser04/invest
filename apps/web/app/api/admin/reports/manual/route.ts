import { isErrorResponse, requireDataAdmin } from '@/lib/admin-auth';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function POST(request: Request) {
  const auth = await requireDataAdmin();
  if (isErrorResponse(auth)) return auth;
  const { supabase } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('INVALID_JSON', 400);
  }
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const issuerId = input.issuerId ? String(input.issuerId) : null;
  const securityId = input.securityId ? String(input.securityId) : null;
  const fiscalYear = Number(input.fiscalYear);
  const title = String(input.title ?? '').trim();
  const sourceUrl = String(input.sourceUrl ?? '').trim();
  if ((!issuerId && !securityId) || !title || !sourceUrl || !Number.isInteger(fiscalYear)) {
    return jsonError('MISSING_FIELDS', 400);
  }

  const { data, error } = await supabase.rpc('upsert_company_document_manual', {
    p_id: input.id ? String(input.id) : null,
    p_issuer_id: issuerId,
    p_security_id: securityId,
    p_document_type: 'annual_report',
    p_fiscal_year: fiscalYear,
    p_title: title,
    p_source_url: sourceUrl,
    p_publication_date: input.publicationDate ? String(input.publicationDate) : null,
    p_language: input.language ? String(input.language) : null,
  });
  if (error) return jsonError(error.message, 422);
  return Response.json({ id: data });
}
