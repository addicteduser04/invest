begin;

-- Official company documents (annual reports for this milestone). PDFs are NOT mirrored into
-- Supabase Storage yet -- source_url points directly at the official issuer/regulator
-- attachment (see docs/COMPANY_DOCUMENTS.md). The schema is future-compatible with other
-- document types and a later binary-archival phase without changing shape.
create table market.company_documents (
  id uuid primary key default gen_random_uuid(),
  security_id uuid not null references market.securities(id),
  document_type text not null check(document_type in (
    'annual_report','half_year_report','financial_statements','earnings_release','presentation','other'
  )),
  fiscal_year integer not null check(fiscal_year between 1990 and 2100),
  title text not null check(length(trim(title))>0),
  source_provider_id text not null check(source_provider_id in ('ammc_public_documents','admin_manual')),
  source_url text not null check(source_url ~ '^https://'),
  -- Nullable and never inferred from fiscal_year: matches market.fundamentals' discipline --
  -- an unknown publication date must stay unknown rather than defaulting to a guess.
  publication_date date,
  language text,
  file_name text,
  file_size_bytes bigint check(file_size_bytes is null or file_size_bytes>=0),
  checksum text,
  status text not null default 'published' check(status in ('published','unavailable','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The natural idempotency key: the official document URL always identifies the same
  -- document. (security_id, document_type, fiscal_year) is deliberately NOT unique -- a
  -- single issuer/year can carry multiple distinct annual-report attachments (e.g. a
  -- consolidated report and a separate universal registration document).
  unique(source_provider_id,source_url)
);

create index market_company_documents_security_type_year_idx
  on market.company_documents(security_id,document_type,fiscal_year desc);

-- Explicit, transparent issuer alias mapping -- priority-1 matching signal. AMMC issuer
-- names/ids frequently differ from BVC ticker/name (e.g. "Itissalat Al-Maghrib" vs AMMC's
-- "MAROC TELECOM"), so silent fuzzy matching is never used; every alias here was deliberately
-- reviewed and recorded.
create table market.company_document_aliases (
  id uuid primary key default gen_random_uuid(),
  security_id uuid not null references market.securities(id),
  source_provider_id text not null check(source_provider_id in ('ammc_public_documents')),
  source_issuer_id text not null,
  source_issuer_name text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  unique(security_id,source_provider_id),
  unique(source_provider_id,source_issuer_id)
);

-- Issuers discovered at the source that could not be deterministically matched to a
-- SaifInvest security. Never silently attached to a guessed company; surfaced here for
-- data_admin review instead. Re-syncing an issuer that is still unmatched only refreshes
-- last_seen_at/name -- it never resets an admin's resolved/ignored decision.
create table market.unmatched_document_issuers (
  id uuid primary key default gen_random_uuid(),
  source_provider_id text not null check(source_provider_id in ('ammc_public_documents')),
  source_issuer_id text not null,
  source_issuer_name text not null,
  candidate_security_id uuid references market.securities(id),
  status text not null default 'open' check(status in ('open','resolved','ignored')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  unique(source_provider_id,source_issuer_id)
);

-- Durable sync-run audit trail, mirroring market.fundamentals_import_runs' role: one row per
-- syncAnnualReports() invocation (CLI or admin-triggered), append-only. Raw AMMC HTML is never
-- persisted here -- only discovery counts and small structured summaries.
create table market.document_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_provider_id text not null check(source_provider_id in ('ammc_public_documents')),
  status text not null check(status in ('running','completed','failed')),
  dry_run boolean not null default false,
  scope jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  documents_discovered integer not null default 0,
  documents_matched integer not null default 0,
  documents_inserted integer not null default 0,
  documents_updated integer not null default 0,
  documents_unchanged integer not null default 0,
  unmatched_issuers jsonb not null default '[]'::jsonb,
  failures jsonb not null default '[]'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index market_document_sync_runs_started_at_idx on market.document_sync_runs(started_at desc);

create trigger document_sync_runs_no_delete
  before delete on market.document_sync_runs
  for each row execute function private.prevent_mutation();

alter table market.company_documents enable row level security;
alter table market.company_document_aliases enable row level security;
alter table market.unmatched_document_issuers enable row level security;
alter table market.document_sync_runs enable row level security;

-- No RLS policies are defined on any of the four tables above: every direct table grant is
-- revoked below and all access is mediated through the views/functions that follow (same
-- pattern as market.fundamentals). The sync pipeline itself (CLI + admin "Sync now" route)
-- connects with a direct trusted WORKER_DATABASE_URL connection, like @bvc/market-ingestion's
-- PgIngestionStore, and is therefore unaffected by RLS.

revoke all on market.company_documents from anon,authenticated;
revoke all on market.company_document_aliases from anon,authenticated;
revoke all on market.unmatched_document_issuers from anon,authenticated;
revoke all on market.document_sync_runs from anon,authenticated;

-- Product-safe read model: published documents only, no admin/audit metadata.
-- source_provider_id IS exposed (unlike e.g. sync failures/admin notes): the product UI needs
-- it to render a human-friendly attribution label ("Source: AMMC" / "Source: SaifInvest"),
-- the same way the existing market-data providerLabel() maps bvc_public_testing etc. -- the
-- rule from docs/COMPANY_DOCUMENTS.md is "never show the raw string in the UI", not "the
-- server may never know which provider it was".
create view public.security_company_documents with (security_invoker=false, security_barrier=true) as
select
  d.id,
  d.security_id,
  d.document_type,
  d.fiscal_year,
  d.title,
  d.source_provider_id,
  d.source_url,
  d.publication_date,
  d.language,
  d.file_name,
  d.file_size_bytes
from market.company_documents d
where d.status='published';

revoke all on public.security_company_documents from public;
grant select on public.security_company_documents to anon,authenticated;

-- Admin: maintain the issuer alias table (priority-1 matching).
create function public.list_company_document_aliases()
returns table(
  id uuid,security_id uuid,source_provider_id text,source_issuer_id text,source_issuer_name text,
  created_at timestamptz
)
language sql stable security definer set search_path='' as $$
  select a.id,a.security_id,a.source_provider_id,a.source_issuer_id,a.source_issuer_name,a.created_at
  from market.company_document_aliases a
  where auth.uid() is not null and private.has_role('data_admin')
  order by a.source_issuer_name
$$;

create function public.upsert_company_document_alias(
  p_security_id uuid,p_source_provider_id text,p_source_issuer_id text,p_source_issuer_name text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;
  if p_source_provider_id<>'ammc_public_documents' then raise exception 'UNKNOWN_PROVIDER'; end if;
  if not exists(select 1 from market.securities where id=p_security_id) then
    raise exception 'UNKNOWN_SECURITY';
  end if;
  insert into market.company_document_aliases(
    security_id,source_provider_id,source_issuer_id,source_issuer_name,created_by
  ) values(p_security_id,p_source_provider_id,trim(p_source_issuer_id),trim(p_source_issuer_name),v_user)
  on conflict(security_id,source_provider_id) do update set
    source_issuer_id=excluded.source_issuer_id,
    source_issuer_name=excluded.source_issuer_name
  returning id into v_id;
  return v_id;
end $$;

-- Admin: review/resolve unmatched issuers surfaced by sync runs.
create function public.list_unmatched_document_issuers(p_status text default 'open')
returns table(
  id uuid,source_provider_id text,source_issuer_id text,source_issuer_name text,
  candidate_security_id uuid,status text,first_seen_at timestamptz,last_seen_at timestamptz
)
language sql stable security definer set search_path='' as $$
  select u.id,u.source_provider_id,u.source_issuer_id,u.source_issuer_name,
    u.candidate_security_id,u.status,u.first_seen_at,u.last_seen_at
  from market.unmatched_document_issuers u
  where auth.uid() is not null and private.has_role('data_admin')
    and (p_status is null or u.status=p_status)
  order by u.last_seen_at desc
$$;

create function public.resolve_unmatched_document_issuer(p_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('resolved','ignored','open') then raise exception 'INVALID_STATUS'; end if;
  update market.unmatched_document_issuers
    set status=p_status,
        resolved_at=case when p_status='open' then null else now() end,
        resolved_by=case when p_status='open' then null else v_user end
    where id=p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

-- Admin: manual fallback metadata entry/fix (section 10) -- always source_provider_id
-- 'admin_manual', so provenance stays honest even when a human typed it in.
create function public.upsert_company_document_manual(
  p_id uuid,p_security_id uuid,p_document_type text,p_fiscal_year integer,p_title text,
  p_source_url text,p_publication_date date,p_language text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from market.securities where id=p_security_id) then
    raise exception 'UNKNOWN_SECURITY';
  end if;
  if p_document_type not in ('annual_report','half_year_report','financial_statements','earnings_release','presentation','other') then
    raise exception 'INVALID_DOCUMENT_TYPE';
  end if;
  if p_source_url !~ '^https://' then raise exception 'INVALID_SOURCE_URL'; end if;
  if p_fiscal_year is null or p_fiscal_year<1990 or p_fiscal_year>2100 then raise exception 'INVALID_FISCAL_YEAR'; end if;
  if p_title is null or length(trim(p_title))=0 then raise exception 'INVALID_TITLE'; end if;

  if p_id is not null then
    update market.company_documents set
      security_id=p_security_id,document_type=p_document_type,fiscal_year=p_fiscal_year,
      title=trim(p_title),source_url=p_source_url,publication_date=p_publication_date,
      language=nullif(trim(coalesce(p_language,'')),''),updated_at=now()
    where id=p_id and source_provider_id='admin_manual'
    returning id into v_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    return v_id;
  end if;

  insert into market.company_documents(
    security_id,document_type,fiscal_year,title,source_provider_id,source_url,
    publication_date,language,status
  ) values(
    p_security_id,p_document_type,p_fiscal_year,trim(p_title),'admin_manual',p_source_url,
    p_publication_date,nullif(trim(coalesce(p_language,'')),''),'published'
  )
  on conflict(source_provider_id,source_url) do update set
    security_id=excluded.security_id,document_type=excluded.document_type,
    fiscal_year=excluded.fiscal_year,title=excluded.title,
    publication_date=excluded.publication_date,language=excluded.language,updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

-- Admin: coverage dashboard stats (section 9).
create function public.company_documents_coverage_stats()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object(
    'companiesWithReports',(
      select count(distinct security_id) from market.company_documents
      where document_type='annual_report' and status='published'
    ),
    'companiesWithoutReports',(
      select count(*) from market.securities s
      where s.listing_status in ('active','suspended')
        and not exists(
          select 1 from market.company_documents d
          where d.security_id=s.id and d.document_type='annual_report' and d.status='published'
        )
    ),
    'totalReports',(
      select count(*) from market.company_documents
      where document_type='annual_report' and status='published'
    ),
    'earliestYear',(
      select min(fiscal_year) from market.company_documents
      where document_type='annual_report' and status='published'
    ),
    'latestYear',(
      select max(fiscal_year) from market.company_documents
      where document_type='annual_report' and status='published'
    ),
    'unmatchedIssuers',(
      select count(*) from market.unmatched_document_issuers where status='open'
    ),
    'lastSync',(
      select jsonb_build_object('id',id,'status',status,'startedAt',started_at,'finishedAt',finished_at)
      from market.document_sync_runs order by started_at desc limit 1
    )
  ) into v_result;
  return v_result;
end $$;

create function public.list_document_sync_runs(p_limit integer default 20)
returns table(
  id uuid,status text,dry_run boolean,scope jsonb,started_at timestamptz,finished_at timestamptz,
  documents_discovered integer,documents_matched integer,documents_inserted integer,
  documents_updated integer,documents_unchanged integer,unmatched_issuers jsonb,failures jsonb
)
language sql stable security definer set search_path='' as $$
  select r.id,r.status,r.dry_run,r.scope,r.started_at,r.finished_at,
    r.documents_discovered,r.documents_matched,r.documents_inserted,
    r.documents_updated,r.documents_unchanged,r.unmatched_issuers,r.failures
  from market.document_sync_runs r
  where auth.uid() is not null and private.has_role('data_admin')
  order by r.started_at desc
  limit least(coalesce(p_limit,20),100)
$$;

revoke all on function public.list_company_document_aliases() from public;
revoke all on function public.upsert_company_document_alias(uuid,text,text,text) from public;
revoke all on function public.list_unmatched_document_issuers(text) from public;
revoke all on function public.resolve_unmatched_document_issuer(uuid,text) from public;
revoke all on function public.upsert_company_document_manual(uuid,uuid,text,integer,text,text,date,text) from public;
revoke all on function public.company_documents_coverage_stats() from public;
revoke all on function public.list_document_sync_runs(integer) from public;

grant execute on function public.list_company_document_aliases() to authenticated;
grant execute on function public.upsert_company_document_alias(uuid,text,text,text) to authenticated;
grant execute on function public.list_unmatched_document_issuers(text) to authenticated;
grant execute on function public.resolve_unmatched_document_issuer(uuid,text) to authenticated;
grant execute on function public.upsert_company_document_manual(uuid,uuid,text,integer,text,text,date,text) to authenticated;
grant execute on function public.company_documents_coverage_stats() to authenticated;
grant execute on function public.list_document_sync_runs(integer) to authenticated;

commit;
