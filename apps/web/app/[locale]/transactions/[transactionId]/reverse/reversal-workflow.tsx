'use client';
import React, { useRef, useState } from 'react';
import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';
import { SecurityPicker, type Security } from '@/components/security-picker';
import {
  transactionTypeLabel,
  transactionTypes,
  type TransactionType,
} from '@/lib/transaction-types';

export type ReversalTransaction = {
  id: string;
  portfolioId: string;
  portfolioName: string;
  type: string;
  tradeDate: string;
  settlementDate: string;
  securityId?: string;
  securityLabel?: string;
  quantity?: string;
  unitPrice?: string;
  grossAmount?: string;
  fees: string;
  taxes: string;
  netAmount: string;
  currency: 'MAD';
  importId?: string;
  reversedById?: string;
};

const isKnownType = (value: string): value is TransactionType =>
  (transactionTypes as string[]).includes(value);

const decimalWithSign = (value: string) =>
  value.startsWith('-') || value === '0' ? value : `+${value}`;
const negateDecimal = (value: string) => {
  if (value === '0' || /^0(?:\.0+)?$/.test(value)) return value;
  return value.startsWith('-') ? value.slice(1) : `-${value}`;
};

export function ReversalWorkflow({
  locale,
  transaction,
  securities,
}: {
  locale: Locale;
  transaction: ReversalTransaction;
  securities: Security[];
}) {
  const t = getUi(locale);
  const [reason, setReason] = useState('');
  const [withReplacement, setWithReplacement] = useState(false);
  const [replacementType, setReplacementType] = useState<TransactionType>('deposit');
  const [replacementSecurityId, setReplacementSecurityId] = useState('');
  const [replacementSecurityQuery, setReplacementSecurityQuery] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [failure, setFailure] = useState<{ code: string; message: string }>();
  const key = useRef(globalThis.crypto?.randomUUID?.() ?? `reversal-${Date.now()}-request`);
  const status = useRef<HTMLDivElement>(null);
  const replacementSecurityOperation = replacementType === 'buy' || replacementType === 'sell';

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || success || !confirmed) return;
    setBusy(true);
    setFailure(undefined);
    const form = new FormData(event.currentTarget);
    const replacement = withReplacement
      ? {
          type: replacementType,
          settlementDate: String(form.get('replacementDate')),
          ...(replacementSecurityOperation
            ? {
                securityId: replacementSecurityId,
                quantity: String(form.get('quantity')),
                unitPrice: String(form.get('unitPrice')),
                fees: String(form.get('fees') || '0'),
                taxes: String(form.get('taxes') || '0'),
              }
            : {
                amount: String(form.get('amount')),
                ...(replacementType === 'dividend'
                  ? { taxes: String(form.get('taxes') || '0') }
                  : {}),
              }),
          currency: 'MAD',
        }
      : undefined;
    const response = await fetch(
      `/api/portfolios/${transaction.portfolioId}/transactions/${transaction.id}/reverse`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          locale,
          reason,
          idempotencyReference: key.current,
          ...(replacement ? { replacement } : {}),
        }),
      },
    );
    const body = await response.json();
    if (response.ok) setSuccess(true);
    else setFailure(body);
    setBusy(false);
    queueMicrotask(() => status.current?.focus());
  };

  return (
    <div className="correction-flow">
      <div ref={status} className="status-message" role="status" aria-live="polite" tabIndex={-1}>
        {busy ? t.reversalBusy : success ? t.reversalSuccess : (failure?.message ?? '')}
      </div>
      <h1>{t.reversalTitle}</h1>
      <p className="notice">{t.reversalPermanentNotice}</p>
      <dl className="summary-grid">
        {[
          [t.dashboard, transaction.portfolioName],
          [
            t.type,
            isKnownType(transaction.type)
              ? transactionTypeLabel(transaction.type, locale)
              : t.reversal,
          ],
          [t.date, transaction.settlementDate],
          [t.security, transaction.securityLabel],
          [t.quantity, transaction.quantity],
          [t.unitPrice, transaction.unitPrice],
          [t.fees, transaction.fees],
          [t.taxes, transaction.taxes],
          [t.reversalOriginalCashEffect, `${decimalWithSign(transaction.netAmount)} MAD`],
          [t.reversalCounterEffect, `${decimalWithSign(negateDecimal(transaction.netAmount))} MAD`],
          [t.reversalSourceImport, transaction.importId],
        ].flatMap(([label, value]) =>
          value
            ? [
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className="technical" dir="ltr">
                    {value}
                  </dd>
                </div>,
              ]
            : [],
        )}
      </dl>
      {transaction.reversedById ? (
        <p className="error-text" role="alert">
          {t.reversalAlreadyReversed}
        </p>
      ) : (
        <form className="form panel" onSubmit={(event) => void submit(event)}>
          <label htmlFor="reversal-reason">{t.reversalReasonLabel}</label>
          <textarea
            id="reversal-reason"
            name="reason"
            minLength={8}
            maxLength={1000}
            required
            disabled={busy}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <label className="check-row">
            <input
              type="checkbox"
              checked={withReplacement}
              disabled={busy}
              onChange={(event) => setWithReplacement(event.target.checked)}
            />
            {t.reversalReplaceLabel}
          </label>
          {withReplacement ? (
            <fieldset className="replacement-fields">
              <label>
                {t.replacementType}
                <select
                  name="replacementType"
                  value={replacementType}
                  onChange={(event) => setReplacementType(event.target.value as TransactionType)}
                >
                  {transactionTypes.map((type) => (
                    <option key={type} value={type}>
                      {transactionTypeLabel(type, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.replacementDate}
                <input name="replacementDate" type="date" required />
              </label>
              {replacementSecurityOperation ? (
                <>
                  <SecurityPicker
                    label={t.security}
                    securities={securities}
                    selectedId={replacementSecurityId}
                    query={replacementSecurityQuery}
                    onQueryChange={(value) => {
                      setReplacementSecurityQuery(value);
                      setReplacementSecurityId('');
                    }}
                    onSelect={(id) => {
                      setReplacementSecurityId(id);
                      setReplacementSecurityQuery('');
                    }}
                    placeholder={t.securitySearchPlaceholder}
                    noResultsLabel={t.noMarketResults}
                    resultsId="replacement-security-results"
                  />
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
                    <input name="fees" inputMode="decimal" pattern="\d+(\.\d+)?" defaultValue="0" />
                  </label>
                </>
              ) : (
                <label>
                  {t.amount}
                  <input name="amount" inputMode="decimal" pattern="\d+(\.\d+)?" required />
                </label>
              )}
              {replacementType === 'dividend' || replacementSecurityOperation ? (
                <label>
                  {t.taxes}
                  <input name="taxes" inputMode="decimal" pattern="\d+(\.\d+)?" defaultValue="0" />
                </label>
              ) : null}
            </fieldset>
          ) : null}
          <label className="check-row">
            <input
              type="checkbox"
              required
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {t.reversalConfirmLabel}
          </label>
          {failure ? <p className="error-text">{failure.message}</p> : null}
          <button
            className="button"
            disabled={
              busy ||
              success ||
              !confirmed ||
              reason.trim().length < 8 ||
              (withReplacement && replacementSecurityOperation && !replacementSecurityId)
            }
          >
            {t.reversalSubmit}
          </button>
        </form>
      )}
      <a className="button secondary" href={`/${locale}/dashboard#transactions`}>
        {t.reversalBackLink}
      </a>
    </div>
  );
}
