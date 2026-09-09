import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const issuerSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  countryCode: z.string().nullable(),
  countryName: z.string().nullable(),
  issuerType: z.string().nullable(),
  equityListingStatus: z.string(),
  website: z.string().nullable(),
  sector: z.string().nullable(),
  securityId: z.string().nullable(),
  securityTicker: z.string().nullable(),
});

export type IssuerSummary = z.infer<typeof issuerSchema>;

interface IssuerDirectoryRow {
  id: string;
  name: string;
  slug: string;
  country_code: string | null;
  country_name: string | null;
  issuer_type: string | null;
  equity_listing_status: string;
  website: string | null;
  sector: string | null;
  security_id: string | null;
  security_ticker: string | null;
}

function toIssuerSummary(row: IssuerDirectoryRow): IssuerSummary {
  return issuerSchema.parse({
    id: row.id,
    name: row.name,
    slug: row.slug,
    countryCode: row.country_code,
    countryName: row.country_name,
    issuerType: row.issuer_type,
    equityListingStatus: row.equity_listing_status,
    website: row.website,
    sector: row.sector,
    securityId: row.security_id,
    securityTicker: row.security_ticker,
  });
}

/** Reads the public issuer directory (public.issuer_directory), sorted by name -- the source
 * for /[locale]/companies. Real issuers only (synthetic dev fixtures never appear here). */
export async function listIssuers(): Promise<IssuerSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('issuer_directory')
    .select(
      'id,name,slug,country_code,country_name,issuer_type,equity_listing_status,website,sector,security_id,security_ticker',
    )
    .order('name');
  if (error) throw error;
  return (data ?? []).map(toIssuerSummary);
}

/** Reads one issuer by its public slug -- the source for /[locale]/companies/[slug]. */
export async function readIssuerBySlug(slug: string): Promise<IssuerSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('issuer_directory')
    .select(
      'id,name,slug,country_code,country_name,issuer_type,equity_listing_status,website,sector,security_id,security_ticker',
    )
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data ? toIssuerSummary(data as IssuerDirectoryRow) : null;
}
