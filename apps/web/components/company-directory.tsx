'use client';

import React, { useMemo, useState } from 'react';
import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';
import type { IssuerSummary } from '@/lib/issuer-read';

type FilterKey = 'all' | 'listed' | 'unlisted' | 'foreign' | 'historical';

function classify(issuer: IssuerSummary): FilterKey {
  if (issuer.equityListingStatus === 'listed_bvc') return 'listed';
  if (issuer.equityListingStatus === 'historical_or_delisted') return 'historical';
  if (issuer.issuerType === 'foreign_issuer') return 'foreign';
  return 'unlisted';
}

export function CompanyDirectory({
  locale,
  issuers,
}: {
  locale: Locale;
  issuers: IssuerSummary[];
}) {
  const t = getUi(locale);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  const filters: Array<{ key: FilterKey; label: string }> = [
    { key: 'all', label: t.companiesFilterAll },
    { key: 'listed', label: t.companiesFilterListed },
    { key: 'unlisted', label: t.companiesFilterUnlisted },
    { key: 'foreign', label: t.companiesFilterForeign },
    { key: 'historical', label: t.companiesFilterHistorical },
  ];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return issuers.filter((issuer) => {
      if (filter !== 'all' && classify(issuer) !== filter) return false;
      if (!q) return true;
      return (
        issuer.name.toLowerCase().includes(q) ||
        (issuer.securityTicker ?? '').toLowerCase().includes(q)
      );
    });
  }, [issuers, query, filter]);

  return (
    <>
      <div className="public-search" style={{ marginBlock: '16px' }}>
        <label>
          <span className="public-search-glyph" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.companiesSearchPlaceholder}
          />
        </label>
      </div>
      <div className="csv-workflow-steps" role="group" aria-label={t.companiesFilterAll}>
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`status-chip${filter === f.key ? ' is-running' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="security-v2-note">{t.companiesEmpty}</p>
      ) : (
        <div className="security-v2-related">
          <div>
            {filtered.map((issuer) => (
              <a href={`/${locale}/companies/${issuer.slug}`} key={issuer.id}>
                <span dir="ltr">{issuer.securityTicker ?? '—'}</span>
                <strong>{issuer.name}</strong>
                <em dir="ltr">
                  {issuer.equityListingStatus === 'listed_bvc'
                    ? t.companiesBadgeListed
                    : classify(issuer) === 'foreign'
                      ? t.companiesBadgeForeign
                      : classify(issuer) === 'historical'
                        ? t.companiesBadgeHistorical
                        : t.companiesBadgeUnlisted}
                </em>
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
