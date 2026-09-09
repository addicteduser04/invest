begin;

-- Deliberately reviewed AMMC issuer id <-> SaifInvest issuer links, seeded ahead of the first
-- full AMMC sync. Without these, well-known companies whose AMMC display name differs from
-- their BVC name (e.g. "Bank of Africa - Groupe BMCE (BOA)" vs our "BANK OF AFRICA") would fail
-- exact-normalized-name matching on a fresh sync and get a spurious duplicate issuer created.
-- Matched by ticker -> market.securities.issuer_id; every ticker below is verified to exist.
-- Extends the same reviewed set already carried by 202609070002 (IAM, BCP, S2M).

update market.issuers i set ammc_issuer_id=v.ammc_id,ammc_issuer_name=v.ammc_name,updated_at=now()
from (values
  ('ADH','34561','ADDOHA'),
  ('ADI','2731','Alliances Développement Immobilier (ADI)'),
  ('BOA','2741','Bank of Africa - Groupe BMCE (BOA)'),
  ('CDM','2750','Crédit du Maroc (CDM)'),
  ('CIH','2757','CIH Bank'),
  ('CMT','2762','Compagnie Minière de Touissit (CMT)'),
  ('LHM','2784','HOLCIM MAROC'),
  ('MSA','2799','MARSA MAROC'),
  ('NKL','2772','ENNAKL AUTOMOBILES'),
  ('OUL','2811','OULMES'),
  ('RDS','15696','Résidences Dar Saada (RDS)'),
  ('SAH','2760','Sanlam Maroc (ex Saham Assurance)'),
  ('SBM','2747','SOCIETE DES BOISSONS DU MAROC (SBM)')
) as v(ticker,ammc_id,ammc_name)
join market.securities s on s.ticker=v.ticker
where i.id=s.issuer_id;

commit;
