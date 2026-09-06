import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

interface CompanyDocumentRow {
  id: string;
  document_type: string;
  fiscal_year: number;
  title: string;
  source_provider_id: string;
  source_url: string;
  publication_date: string | null;
  language: string | null;
  file_name: string | null;
  file_size_bytes: number | string | null;
}

const annualReportSchema = z.object({
  id: z.string(),
  fiscalYear: z.number(),
  title: z.string(),
  sourceProviderId: z.string(),
  sourceUrl: z.string(),
  publicationDate: z.string().nullable(),
  language: z.string().nullable(),
  fileName: z.string().nullable(),
  fileSizeBytes: z.number().nullable(),
});

export type AnnualReportView = z.infer<typeof annualReportSchema>;

/**
 * Reads annual reports for one security from the public, security-barrier'd
 * `security_company_documents` view (published only, no admin/audit/matching-confidence
 * fields), newest fiscal year first. Mirrors apps/web/lib/fundamentals-read.ts's
 * authenticate/fetch-narrow/shape pattern -- this is public data, no ownership check.
 */
export async function readSecurityAnnualReports(securityId: string): Promise<AnnualReportView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('security_company_documents')
    .select(
      'id,document_type,fiscal_year,title,source_provider_id,source_url,publication_date,language,file_name,file_size_bytes',
    )
    .eq('security_id', securityId)
    .eq('document_type', 'annual_report')
    .order('fiscal_year', { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as CompanyDocumentRow[];
  return rows.map((row) =>
    annualReportSchema.parse({
      id: row.id,
      fiscalYear: row.fiscal_year,
      title: row.title,
      sourceProviderId: row.source_provider_id,
      sourceUrl: row.source_url,
      publicationDate: row.publication_date,
      language: row.language,
      fileName: row.file_name,
      fileSizeBytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
    }),
  );
}
