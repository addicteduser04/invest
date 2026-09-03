'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';
import { SecurityPicker, type Security } from '@/components/security-picker';
import { MAX_COMPARE_SECURITIES } from '@/lib/compare-metrics';

export function CompareSelector({
  locale,
  availableSecurities,
  selectedSecurities,
}: {
  locale: Locale;
  availableSecurities: Security[];
  selectedSecurities: Security[];
}) {
  const t = getUi(locale);
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const selectedIds = selectedSecurities.map((security) => security.id);
  const pickable = availableSecurities.filter((security) => !selectedIds.includes(security.id));
  const atMax = selectedIds.length >= MAX_COMPARE_SECURITIES;

  const navigate = (ids: string[]) => {
    const queryString = ids.length ? `?securities=${ids.join(',')}` : '';
    router.push(`/${locale}/compare${queryString}`);
  };

  const addSecurity = (id: string) => {
    if (atMax) return;
    setQuery('');
    setAdding(false);
    navigate([...selectedIds, id]);
  };

  const removeSecurity = (id: string) => {
    navigate(selectedIds.filter((selectedId) => selectedId !== id));
  };

  return (
    <div className="compare-v2-selector">
      <div className="compare-v2-chips" role="list">
        {selectedSecurities.map((security) => (
          <span className="compare-v2-chip" role="listitem" key={security.id}>
            <a href={`/${locale}/market/${security.id}`}>
              <b dir="ltr">{security.ticker}</b>
              <small>{security.name}</small>
            </a>
            <button
              type="button"
              aria-label={`${t.removeFromComparison} ${security.ticker}`}
              onClick={() => removeSecurity(security.id)}
            >
              ×
            </button>
          </span>
        ))}
        {!atMax ? (
          <button
            type="button"
            className="compare-v2-add-chip"
            aria-expanded={adding}
            onClick={() => setAdding((value) => !value)}
          >
            {adding ? '×' : '+'} {t.compareAddSecurity}
          </button>
        ) : null}
      </div>

      {atMax ? <p className="compare-v2-max-note">{t.compareMaxReached}</p> : null}

      {adding && !atMax ? (
        <div className="compare-v2-add-panel">
          <SecurityPicker
            label={t.compareAddSecurity}
            securities={pickable}
            selectedId=""
            query={query}
            onQueryChange={setQuery}
            onSelect={addSecurity}
            placeholder={t.securitySearchPlaceholder}
            noResultsLabel={t.noMarketResults}
            resultsId="compare-security-results"
            variant="dropdown"
            autoFocus
          />
        </div>
      ) : null}
    </div>
  );
}
