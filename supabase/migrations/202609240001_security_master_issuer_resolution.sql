begin;

-- Security-master imports predate the issuer model: upsert_market_security_master (last
-- redefined in 202608280009) inserts new market.securities rows without issuer_id, which
-- 202609070001 made NOT NULL. Every *new* security therefore failed with a not-null violation;
-- updates of existing securities were unaffected. This migration resolves a genuine issuer for each
-- new security inside the same transaction, using the rule already established for issuers:
--
--   1. exact normalized-name match (private.normalize_company_name) against exactly ONE genuine
--      (non-synthetic) issuer -> reuse it (same precedence as create_issuer_manual/AMMC sync);
--   2. more than one match -> AMBIGUOUS_ISSUER, never guessed (mirrors the AMMC "ambiguous" rule);
--   3. no match -> create the issuer from the source's own issuer name (BVC `emetteur`), exactly as
--      the 202609070001 backfill seeded issuers from securities.issuer_name;
--   4. no issuer name at all -> ISSUER_IDENTITY_MISSING; nothing is invented from the ticker or
--      the instrument name.
--
-- Existing securities keep their issuer_id untouched (no re-linking on re-import).

create function private.resolve_listed_issuer(p_issuer_name text,p_sector text,p_ticker text)
returns uuid language plpgsql set search_path='' as $$
declare
  v_name text:=trim(coalesce(p_issuer_name,''));
  v_normalized text:=private.normalize_company_name(p_issuer_name);
  v_ids uuid[];
  v_id uuid;
  v_slug text;
  v_suffix integer:=1;
begin
  if v_name='' or v_normalized='' then
    raise exception 'ISSUER_IDENTITY_MISSING: %',p_ticker;
  end if;

  -- Serializes concurrent imports of the same company so two transactions cannot both miss the
  -- lookup and create duplicate issuers.
  perform pg_advisory_xact_lock(hashtextextended('market.issuers:'||v_normalized,0));

  select array_agg(id) into v_ids
  from market.issuers
  where not is_synthetic
    and (normalized_name=v_normalized or private.normalize_company_name(name)=v_normalized);

  if cardinality(v_ids)>1 then
    raise exception 'AMBIGUOUS_ISSUER: % (%)',p_ticker,v_name;
  end if;

  if cardinality(v_ids)=1 then
    v_id:=v_ids[1];
    -- The issuer now has a BVC-listed equity; correct only the "not listed" classifications
    -- (e.g. an issuer first discovered by the AMMC sync). Foreign/financial/historical types stay.
    update market.issuers
      set equity_listing_status=case when equity_listing_status in ('no_listed_bvc_equity','unknown')
                                     then 'listed_bvc' else equity_listing_status end,
          issuer_type=case when issuer_type is null or issuer_type='unlisted_company'
                           then 'listed_company' else issuer_type end,
          updated_at=now()
      where id=v_id
        and (equity_listing_status in ('no_listed_bvc_equity','unknown')
             or issuer_type is null or issuer_type='unlisted_company');
    return v_id;
  end if;

  v_slug:=private.slugify(v_name);
  while exists(select 1 from market.issuers where slug=v_slug) loop
    v_suffix:=v_suffix+1;
    v_slug:=private.slugify(v_name)||'-'||v_suffix;
  end loop;

  insert into market.issuers(name,normalized_name,slug,sector,issuer_type,equity_listing_status)
  values(v_name,v_normalized,v_slug,nullif(trim(coalesce(p_sector,'')),''),'listed_company','listed_bvc')
  returning id into v_id;
  return v_id;
end $$;

revoke all on function private.resolve_listed_issuer(text,text,text) from public,anon,authenticated;

create or replace function public.upsert_market_security_master(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_row jsonb;
  v_id uuid;
  v_count integer:=0;
  v_inserted integer:=0;
  v_issuers_before integer;
  v_issuers_created integer;
  v_ticker text;
  v_status text;
begin
  if v_user is null or not private.has_role('data_admin') then raise exception 'FORBIDDEN'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>500 then
    raise exception 'INVALID_FILE';
  end if;

  select count(*) into v_issuers_before from market.issuers;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_ticker:=upper(trim(coalesce(v_row->>'ticker','')));
    v_status:=lower(trim(coalesce(v_row->>'listingStatus','active')));
    if v_ticker !~ '^[A-Z0-9._-]{1,20}$'
       or length(trim(coalesce(v_row->>'name',''))) not between 1 and 200
       or length(coalesce(v_row->>'sector',''))>120
       or length(coalesce(v_row->>'issuerName',''))>200
       or v_status not in ('pending','active','suspended','delisted')
       or (nullif(v_row->>'listedOn','') is not null and (v_row->>'listedOn') !~ '^\d{4}-\d{2}-\d{2}$')
       or (nullif(v_row->>'isin','') is not null and upper(v_row->>'isin') !~ '^[A-Z]{2}[A-Z0-9]{10}$')
       or (nullif(v_row->>'shareCount','') is not null and (v_row->>'shareCount') !~ '^\d+$') then
      raise exception 'INVALID_SECURITY_MASTER_ROW';
    end if;

    v_id:=null;
    select id into v_id
      from market.securities
      where ticker=v_ticker
      order by case when listing_status='delisted' then 1 else 0 end,updated_at desc
      limit 1
      for update;

    if v_id is null then
      insert into market.securities(
        name,ticker,sector,listing_status,listed_on,is_synthetic,isin,issuer_name,
        instrument_type,market_segment,share_count,source_provider_id,source_identifier,source_fetched_at,
        issuer_id
      )
      values(
        trim(v_row->>'name'),v_ticker,nullif(trim(coalesce(v_row->>'sector','')),''),v_status,
        nullif(v_row->>'listedOn','')::date,false,nullif(upper(trim(coalesce(v_row->>'isin',''))),''),
        nullif(trim(coalesce(v_row->>'issuerName','')),''),nullif(trim(coalesce(v_row->>'instrumentType','')),''),
        nullif(trim(coalesce(v_row->>'marketSegment','')),''),nullif(v_row->>'shareCount','')::numeric,
        case when nullif(v_row->>'sourceId','') is not null then 'bvc_public_testing' else null end,
        nullif(trim(coalesce(v_row->>'sourceId','')),''),case when nullif(v_row->>'sourceId','') is not null then now() else null end,
        private.resolve_listed_issuer(v_row->>'issuerName',v_row->>'sector',v_ticker)
      )
      returning id into v_id;
      v_inserted:=v_inserted+1;
    else
      update market.securities
        set name=trim(v_row->>'name'),sector=nullif(trim(coalesce(v_row->>'sector','')),''),
            listing_status=v_status,listed_on=coalesce(nullif(v_row->>'listedOn','')::date,listed_on),
            is_synthetic=false,isin=coalesce(nullif(upper(trim(coalesce(v_row->>'isin',''))),''),isin),
            issuer_name=coalesce(nullif(trim(coalesce(v_row->>'issuerName','')),''),issuer_name),
            instrument_type=coalesce(nullif(trim(coalesce(v_row->>'instrumentType','')),''),instrument_type),
            market_segment=coalesce(nullif(trim(coalesce(v_row->>'marketSegment','')),''),market_segment),
            share_count=coalesce(nullif(v_row->>'shareCount','')::numeric,share_count),
            source_provider_id=case when nullif(v_row->>'sourceId','') is not null then 'bvc_public_testing' else source_provider_id end,
            source_identifier=coalesce(nullif(trim(coalesce(v_row->>'sourceId','')),''),source_identifier),
            source_fetched_at=case when nullif(v_row->>'sourceId','') is not null then now() else source_fetched_at end,
            updated_at=now()
        where id=v_id;
    end if;
    v_count:=v_count+1;
  end loop;

  select count(*)-v_issuers_before into v_issuers_created from market.issuers;

  insert into audit.events(actor_id,actor_type,action,entity_type,after_state)
  values(v_user,'admin','market_security_master.upserted','security_master',jsonb_build_object(
    'rows',v_count,'bvcFields',true,'securitiesInserted',v_inserted,'issuersCreated',v_issuers_created));
  return jsonb_build_object(
    'updatedRows',v_count,'securitiesInserted',v_inserted,'securitiesUpdated',v_count-v_inserted,
    'issuersCreated',v_issuers_created);
end $$;

revoke all on function public.upsert_market_security_master(jsonb) from public,anon;
grant execute on function public.upsert_market_security_master(jsonb) to authenticated;

commit;
