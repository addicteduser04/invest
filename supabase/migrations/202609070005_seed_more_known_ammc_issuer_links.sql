begin;

-- Second, additive batch of reviewed AMMC issuer id <-> SaifInvest issuer links, found by
-- running the full-directory dry-run sync and diffing its 187 AMMC issuer names against the 81
-- local securities' issuer names via normalizeAmmcIssuerName. These 12 are legal-name vs.
-- AMMC-brand-abbreviation mismatches that no generic normalization can bridge without risking
-- a false collision elsewhere (e.g. "SOCIETE NATIONALE DE SIDERURGIE" vs AMMC's "SONASID"),
-- so each is a deliberately reviewed, ticker-verified link rather than a fuzzy match. Extends the
-- same reviewed set already carried by 202609070002 (IAM, BCP, S2M) and 202609070004.

update market.issuers i set ammc_issuer_id=v.ammc_id,ammc_issuer_name=v.ammc_name,updated_at=now()
from (values
  ('CTM','2765','CTM'),
  ('DLM','2771','DLM (Delattre Levivier Maroc)'),
  ('GTM','53783','SGTM'),
  ('HPS','2779','HPS SA'),
  ('PRO','2812','PROMOPHARM'),
  ('SID','2829','SONASID'),
  ('SMI','2821','SMI'),
  ('SNP','2822','SNEP'),
  ('SOT','2831','SOTHEMA'),
  ('SRM','2832','SRM SA'),
  ('STR','13541','STROC'),
  ('TGC','44356','TGCC SA')
) as v(ticker,ammc_id,ammc_name)
join market.securities s on s.ticker=v.ticker
where i.id=s.issuer_id;

commit;
