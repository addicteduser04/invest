'use client';

import { useMemo, useRef, useState } from 'react';

export type Security = { id: string; ticker: string; name: string };

export function SecurityPicker({
  label,
  securities,
  selectedId,
  query,
  onQueryChange,
  onSelect,
  placeholder,
  noResultsLabel,
  resultsId = 'security-results',
  variant = 'inline',
  autoFocus = false,
}: {
  label: string;
  securities: Security[];
  selectedId: string;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
  placeholder: string;
  noResultsLabel: string;
  resultsId?: string;
  /** 'inline' (default) always shows results, as in the transaction form. 'dropdown' only
   * shows results while the input is focused, closing as soon as a selection is made. */
  variant?: 'inline' | 'dropdown';
  autoFocus?: boolean;
}) {
  const selected = securities.find((security) => security.id === selectedId);
  const [open, setOpen] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return securities.slice(0, 12);
    return securities
      .filter(
        (security) =>
          security.ticker.toLocaleLowerCase().includes(normalized) ||
          security.name.toLocaleLowerCase().includes(normalized),
      )
      .slice(0, 12);
  }, [securities, query]);

  const showResults = variant === 'inline' || open;

  return (
    <div
      className={
        variant === 'dropdown'
          ? 'transaction-v2-security-picker dropdown'
          : 'transaction-v2-security-picker'
      }
    >
      <label>
        {label}
        <input
          aria-controls={resultsId}
          autoComplete="off"
          autoFocus={autoFocus}
          inputMode="search"
          onChange={(event) => onQueryChange(event.target.value)}
          onFocus={() => {
            if (blurTimeout.current) clearTimeout(blurTimeout.current);
            setOpen(true);
          }}
          onBlur={() => {
            blurTimeout.current = setTimeout(() => setOpen(false), 120);
          }}
          placeholder={placeholder}
          value={selected ? `${selected.ticker} · ${selected.name}` : query}
        />
      </label>
      {showResults ? (
        <div className="transaction-v2-security-results" id={resultsId}>
          {filtered.length ? (
            filtered.map((security) => (
              <button
                className={security.id === selectedId ? 'active' : ''}
                key={security.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(security.id);
                  setOpen(false);
                }}
                type="button"
              >
                <strong dir="ltr">{security.ticker}</strong>
                <span>{security.name}</span>
              </button>
            ))
          ) : (
            <p>{noResultsLabel}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
