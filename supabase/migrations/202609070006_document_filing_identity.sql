begin;

-- Fixes an identity bug: AMMC's PDF attachment URL (source_url) is NOT a reliable proxy for
-- "which filing this is". A single AMMC issuer can have two distinct filing records (different
-- detail pages, different fiscal years) that happen to point at the identical PDF asset --
-- observed live for Meditelecom, whose 2015 and 2017 "Rapports sociaux annuels" filings
-- both attach the same PDF. Under the old unique(source_provider_id,source_url), the sync's
-- persist batch could only keep one of the two (a Postgres batch can't touch the same conflict
-- target twice in one statement), silently collapsing two genuine filings into one row.
--
-- source_record_url is the stable AMMC *filing/detail-page* URL
-- (/fr/espace-emetteurs/etats-financiers/<slug>) -- distinct from source_url, the downloadable
-- PDF asset URL on that page. A FILE is not a FILING: one detail page can itself carry more than
-- one attachment (e.g. an annual report plus a separate universal registration document), so
-- source_record_url alone is not always enough either -- the true identity is the pair.

alter table market.company_documents add column source_record_url text;

-- Deterministic backfill, not a guess: an admin_manual entry has no separate "filing record"
-- concept at all -- the single URL an admin types in already *is* the record's identity, exactly
-- as it behaved before this migration (unique-by-url). Setting source_record_url=source_url for
-- this provider only reproduces that pre-existing behavior under the new, wider key.
update market.company_documents
  set source_record_url=source_url
  where source_provider_id='admin_manual' and source_record_url is null;

-- AMMC-sourced rows cannot be backfilled here: the detail-page URL was never captured by the
-- sync pipeline before this fix, and nothing already stored in this table can reconstruct it
-- without re-crawling AMMC (fabricating one would violate "never invent source data"). These
-- rows stay source_record_url=null -- Postgres treats NULL as distinct from every other value in
-- a unique index, so existing null-identity rows never spuriously conflict with each other or
-- with newly-synced rows. The next full sync (packages/annual-reports) re-discovers every
-- filing's actual detail-page URL and, in its persist step, deterministically reclaims each
-- still-null legacy row by (issuer_id,source_url,fiscal_year) -- the same triple that already
-- uniquely identified it under the old constraint -- before falling back to inserting any
-- genuinely new filing (see upsertDocumentRows in packages/annual-reports/src/store.ts).

alter table market.company_documents drop constraint company_documents_source_provider_id_source_url_key;

-- The corrected identity: a filing is (provider, filing record, asset). This preserves every
-- case already known to be legitimate --
--   * same PDF, two different filing records/years (the Meditelecom case) -> different
--     source_record_url -> both rows persist;
--   * one filing record, two distinct attachments on its detail page -> same source_record_url,
--     different source_url -> both rows persist;
--   * the exact same filing discovered twice (e.g. a listing/pagination overlap) -> identical
--     triple -> collapses to one row, correctly.
alter table market.company_documents
  add constraint company_documents_source_identity_key
  unique(source_provider_id,source_record_url,source_url);

-- upsert_company_document_manual's on-conflict target must move in the same transaction: it
-- referenced the now-dropped 2-column constraint, which would make every fresh manual insert
-- error immediately otherwise. source_record_url=p_source_url on both the insert and the
-- existing p_id-based update path, matching the admin_manual backfill rule above.
create or replace function public.upsert_company_document_manual(
  p_id uuid,p_issuer_id uuid,p_security_id uuid,p_document_type text,p_fiscal_year integer,p_title text,
  p_source_url text,p_publication_date date,p_language text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_issuer_id uuid;
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;

  v_issuer_id:=p_issuer_id;
  if v_issuer_id is null and p_security_id is not null then
    select issuer_id into v_issuer_id from market.securities where id=p_security_id;
  end if;
  if v_issuer_id is null or not exists(select 1 from market.issuers where id=v_issuer_id) then
    raise exception 'UNKNOWN_ISSUER';
  end if;

  if p_document_type not in ('annual_report','half_year_report','financial_statements','earnings_release','presentation','other') then
    raise exception 'INVALID_DOCUMENT_TYPE';
  end if;
  if p_source_url !~ '^https://' then raise exception 'INVALID_SOURCE_URL'; end if;
  if p_fiscal_year is null or p_fiscal_year<1990 or p_fiscal_year>2100 then raise exception 'INVALID_FISCAL_YEAR'; end if;
  if p_title is null or length(trim(p_title))=0 then raise exception 'INVALID_TITLE'; end if;

  if p_id is not null then
    update market.company_documents set
      issuer_id=v_issuer_id,document_type=p_document_type,fiscal_year=p_fiscal_year,
      title=trim(p_title),source_url=p_source_url,source_record_url=p_source_url,
      publication_date=p_publication_date,
      language=nullif(trim(coalesce(p_language,'')),''),updated_at=now()
    where id=p_id and source_provider_id='admin_manual'
    returning id into v_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    return v_id;
  end if;

  insert into market.company_documents(
    issuer_id,document_type,fiscal_year,title,source_provider_id,source_url,source_record_url,
    publication_date,language,status
  ) values(
    v_issuer_id,p_document_type,p_fiscal_year,trim(p_title),'admin_manual',p_source_url,p_source_url,
    p_publication_date,nullif(trim(coalesce(p_language,'')),''),'published'
  )
  on conflict(source_provider_id,source_record_url,source_url) do update set
    issuer_id=excluded.issuer_id,document_type=excluded.document_type,
    fiscal_year=excluded.fiscal_year,title=excluded.title,
    publication_date=excluded.publication_date,language=excluded.language,updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

commit;
