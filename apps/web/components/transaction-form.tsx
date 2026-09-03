'use client';

import React from 'react';
import { useActionState, useRef, useState } from 'react';
import type { Locale } from '@bvc/contracts';
import { recordTransactionV2, type RecordTransactionState } from '@/app/[locale]/auth-actions';
import { getUi } from '@/lib/i18n';
import { SecurityPicker, type Security } from '@/components/security-picker';
import {
  transactionTypeHint,
  transactionTypeLabel,
  transactionTypes,
  type TransactionType,
} from '@/lib/transaction-types';

const numberValue = (value: string) => {
  const normalized = value.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatMoney = (value: number, locale: Locale) =>
  new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA', {
    style: 'currency',
    currency: 'MAD',
    maximumFractionDigits: 2,
  }).format(value);

export function TransactionForm({
  locale,
  portfolioId,
  trackingMode,
  securities,
  defaultType,
}: {
  locale: Locale;
  portfolioId: string;
  trackingMode: 'real_tracking' | 'virtual';
  securities: Security[];
  defaultType?: TransactionType;
}) {
  const t = getUi(locale);
  const [state, formAction, pending] = useActionState<RecordTransactionState, FormData>(
    recordTransactionV2,
    {},
  );
  const [type, setType] = useState<TransactionType>(defaultType ?? 'deposit');
  const [securityId, setSecurityId] = useState('');
  const [securityQuery, setSecurityQuery] = useState('');
  const [amount, setAmount] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [fees, setFees] = useState('0');
  const [taxes, setTaxes] = useState('0');
  const idempotencyKey = useRef(globalThis.crypto?.randomUUID?.() ?? `record-${Date.now()}`);

  const securityOperation = type === 'buy' || type === 'sell';
  const dividendOperation = type === 'dividend';
  const amountOperation = ['deposit', 'withdrawal', 'dividend', 'fee', 'tax'].includes(type);
  const requiresSecurity = securityOperation || dividendOperation;
  const selectedSecurity = securities.find((security) => security.id === securityId);

  const quantityValue = numberValue(quantity);
  const unitPriceValue = numberValue(unitPrice);
  const amountValue = numberValue(amount);
  const feesValue = numberValue(fees);
  const taxesValue = numberValue(taxes);
  const gross = securityOperation ? quantityValue * unitPriceValue : amountValue;
  const netImpact =
    type === 'deposit'
      ? amountValue
      : type === 'withdrawal' || type === 'fee' || type === 'tax'
        ? -amountValue
        : type === 'buy'
          ? -(gross + feesValue + taxesValue)
          : type === 'sell'
            ? gross - feesValue - taxesValue
            : gross - taxesValue;

  return (
    <form className="transaction-v2-form" action={formAction}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="portfolioId" value={portfolioId} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="securityId" value={securityId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey.current} />

      <section className="transaction-v2-type-grid" aria-label={t.transactionType}>
        {transactionTypes.map((value) => (
          <button
            aria-pressed={type === value}
            className={type === value ? 'active' : ''}
            key={value}
            onClick={() => setType(value)}
            type="button"
          >
            <span>{transactionTypeLabel(value, locale, trackingMode)}</span>
            <small>{transactionTypeHint(value, locale)}</small>
          </button>
        ))}
      </section>

      <div className="transaction-v2-entry-grid">
        <section className="transaction-v2-fields">
          <div className="transaction-v2-field-row">
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
                <input
                  name="amount"
                  inputMode="decimal"
                  onChange={(event) => setAmount(event.target.value)}
                  pattern="\d+([,.]\d+)?"
                  required
                  value={amount}
                />
              </label>
            ) : null}
          </div>

          {securityOperation || dividendOperation ? (
            <SecurityPicker
              label={t.security}
              securities={securities}
              selectedId={securityId}
              query={securityQuery}
              onQueryChange={(value) => {
                setSecurityQuery(value);
                setSecurityId('');
              }}
              onSelect={(id) => {
                setSecurityId(id);
                setSecurityQuery('');
              }}
              placeholder={t.securitySearchPlaceholder}
              noResultsLabel={t.noMarketResults}
            />
          ) : null}

          {securityOperation ? (
            <div className="transaction-v2-field-row three">
              <label>
                {t.quantity}
                <input
                  name="quantity"
                  inputMode="decimal"
                  onChange={(event) => setQuantity(event.target.value)}
                  pattern="\d+([,.]\d+)?"
                  required
                  value={quantity}
                />
              </label>
              <label>
                {t.unitPrice}
                <input
                  name="unitPrice"
                  inputMode="decimal"
                  onChange={(event) => setUnitPrice(event.target.value)}
                  pattern="\d+([,.]\d+)?"
                  required
                  value={unitPrice}
                />
              </label>
              <label>
                {t.fees}
                <input
                  name="fees"
                  inputMode="decimal"
                  onChange={(event) => setFees(event.target.value)}
                  pattern="\d+([,.]\d+)?"
                  value={fees}
                />
              </label>
              <label>
                {t.taxes}
                <input
                  name="taxes"
                  inputMode="decimal"
                  onChange={(event) => setTaxes(event.target.value)}
                  pattern="\d+([,.]\d+)?"
                  value={taxes}
                />
              </label>
            </div>
          ) : dividendOperation ? (
            <label>
              {t.taxes}
              <input
                name="taxes"
                inputMode="decimal"
                onChange={(event) => setTaxes(event.target.value)}
                pattern="\d+([,.]\d+)?"
                value={taxes}
              />
            </label>
          ) : null}

          <label>
            {t.note}
            <textarea maxLength={240} name="note" placeholder={t.noteUnsupportedHint} rows={3} />
          </label>

          {state.error ? (
            <p className="transaction-v2-error" role="alert">
              {state.error}
            </p>
          ) : null}

          <div className="transaction-v2-actions">
            <button disabled={pending || (requiresSecurity && !securityId)} type="submit">
              {pending ? t.loading : t.recordSelectedTransaction}
            </button>
            <a href={`/${locale}/dashboard?portfolio=${portfolioId}`}>{t.backToPortfolio}</a>
          </div>
        </section>

        <aside className="transaction-v2-review" aria-label={t.transactionReview}>
          <p className="public-eyebrow">{t.reviewBeforeSubmit}</p>
          <h2>{transactionTypeLabel(type, locale, trackingMode)}</h2>
          <dl>
            <div>
              <dt>{t.grossAmount}</dt>
              <dd className="technical" dir="ltr">
                {formatMoney(gross, locale)}
              </dd>
            </div>
            <div>
              <dt>{t.fees}</dt>
              <dd className="technical" dir="ltr">
                {formatMoney(feesValue, locale)}
              </dd>
            </div>
            <div>
              <dt>{t.taxes}</dt>
              <dd className="technical" dir="ltr">
                {formatMoney(taxesValue, locale)}
              </dd>
            </div>
            <div className="emphasis">
              <dt>{t.netCashImpact}</dt>
              <dd className={`technical ${netImpact >= 0 ? 'positive' : 'negative'}`} dir="ltr">
                {formatMoney(netImpact, locale)}
              </dd>
            </div>
          </dl>
          <p>{trackingMode === 'virtual' ? t.virtualHint : t.realTrackingHint}</p>
          {selectedSecurity ? (
            <span className="transaction-v2-selected-security">
              <b dir="ltr">{selectedSecurity.ticker}</b>
              {selectedSecurity.name}
            </span>
          ) : null}
        </aside>
      </div>
    </form>
  );
}
