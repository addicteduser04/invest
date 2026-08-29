'use client';

import { useState } from 'react';
import type { Locale } from '@bvc/contracts';
import { addTransaction } from '@/app/[locale]/auth-actions';
import { getUi } from '@/lib/i18n';

type Security = { id: string; ticker: string; name: string };

export function TransactionForm({
  locale,
  portfolioId,
  trackingMode,
  securities,
}: {
  locale: Locale;
  portfolioId: string;
  trackingMode: 'real_tracking' | 'virtual';
  securities: Security[];
}) {
  const t = getUi(locale);
  const [type, setType] = useState('deposit');
  const securityOperation = type === 'buy' || type === 'sell';
  const amountOperation = ['deposit', 'withdrawal', 'dividend', 'fee', 'tax'].includes(type);
  return (
    <form className="form transaction-form" action={addTransaction}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="portfolioId" value={portfolioId} />
      <div className="form-grid">
        <label>
          {t.type}
          <select name="type" value={type} onChange={(event) => setType(event.target.value)}>
            {(['deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'fee', 'tax'] as const).map(
              (value) => (
                <option key={value} value={value}>
                  {trackingMode === 'virtual' && value === 'buy'
                    ? t.simulatedBuy
                    : trackingMode === 'virtual' && value === 'sell'
                      ? t.simulatedSell
                      : t[value]}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          {t.date}
          <input
            name="settlementDate"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </label>
        {amountOperation ? (
          <label>
            {t.amount}
            <input name="amount" inputMode="decimal" pattern="\d+(\.\d+)?" required />
          </label>
        ) : null}
        {securityOperation ? (
          <>
            <label>
              {t.security}
              <select name="securityId" required>
                <option value="">—</option>
                {securities.map((security) => (
                  <option key={security.id} value={security.id}>
                    {security.ticker} — {security.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.quantity}
              <input name="quantity" inputMode="decimal" pattern="\d+(\.\d+)?" required />
            </label>
            <label>
              {t.unitPrice}
              <input name="unitPrice" inputMode="decimal" pattern="\d+(\.\d+)?" required />
            </label>
            <label>
              {t.fees}
              <input name="fees" defaultValue="0" inputMode="decimal" pattern="\d+(\.\d+)?" />
            </label>
            <label>
              {t.taxes}
              <input name="taxes" defaultValue="0" inputMode="decimal" pattern="\d+(\.\d+)?" />
            </label>
          </>
        ) : type === 'dividend' ? (
          <label>
            {t.taxes}
            <input name="taxes" defaultValue="0" inputMode="decimal" pattern="\d+(\.\d+)?" />
          </label>
        ) : null}
      </div>
      <p className="microcopy">{trackingMode === 'virtual' ? t.virtualHint : t.realTrackingHint}</p>
      <button className="button" type="submit">
        {t.record}
      </button>
    </form>
  );
}
