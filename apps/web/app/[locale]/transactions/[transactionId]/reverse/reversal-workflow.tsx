'use client';
import React, { useRef, useState } from 'react';

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

const copy = {
  fr: {
    title: 'Annuler ou remplacer l’opération',
    permanent:
      'L’opération originale restera définitivement dans l’historique. Une contre-écriture liée enregistrera son annulation.',
    reason: 'Motif détaillé de l’annulation',
    replace: 'Créer une opération de remplacement',
    confirm: 'Je confirme avoir vérifié l’opération et ses effets',
    submit: 'Enregistrer la correction',
    busy: 'Correction en cours…',
    success: 'Correction enregistrée. L’historique original est préservé.',
    back: 'Retour à l’historique',
    portfolio: 'Portefeuille',
    type: 'Type',
    date: 'Date comptable',
    security: 'Titre',
    quantity: 'Quantité',
    price: 'Prix unitaire',
    fees: 'Frais',
    taxes: 'Taxes',
    cash: 'Effet de trésorerie original',
    inverse: 'Contre-effet dérivé par le serveur',
    imported: 'Import source',
    replacementType: 'Type du remplacement',
    replacementDate: 'Date du remplacement',
    amount: 'Montant',
  },
  ar: {
    title: 'عكس العملية أو استبدالها',
    permanent: 'ستبقى العملية الأصلية محفوظة دائماً في السجل. سيسجل قيد عكسي مرتبط عملية الإلغاء.',
    reason: 'السبب المفصل للعكس',
    replace: 'إنشاء عملية بديلة',
    confirm: 'أؤكد أنني تحققت من العملية وآثارها',
    submit: 'تسجيل التصحيح',
    busy: 'جارٍ تسجيل التصحيح…',
    success: 'تم تسجيل التصحيح مع الحفاظ على السجل الأصلي.',
    back: 'العودة إلى سجل العمليات',
    portfolio: 'المحفظة',
    type: 'النوع',
    date: 'التاريخ المحاسبي',
    security: 'السهم',
    quantity: 'الكمية',
    price: 'سعر الوحدة',
    fees: 'الرسوم',
    taxes: 'الضرائب',
    cash: 'الأثر النقدي الأصلي',
    inverse: 'الأثر العكسي المشتق من الخادم',
    imported: 'مرجع الاستيراد',
    replacementType: 'نوع العملية البديلة',
    replacementDate: 'تاريخ العملية البديلة',
    amount: 'المبلغ',
  },
};

export function ReversalWorkflow({
  locale,
  transaction,
}: {
  locale: 'fr' | 'ar';
  transaction: ReversalTransaction;
}) {
  const t = copy[locale];
  const [reason, setReason] = useState('');
  const [withReplacement, setWithReplacement] = useState(false);
  const [replacementType, setReplacementType] = useState('deposit');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [failure, setFailure] = useState<{ code: string; message: string }>();
  const key = useRef(globalThis.crypto?.randomUUID?.() ?? `reversal-${Date.now()}-request`);
  const status = useRef<HTMLDivElement>(null);

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
          ...(['buy', 'sell'].includes(replacementType)
            ? {
                securityId: String(form.get('securityId')),
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
        {busy ? t.busy : success ? t.success : (failure?.message ?? '')}
      </div>
      <h1>{t.title}</h1>
      <p className="notice">{t.permanent}</p>
      <dl className="summary-grid">
        {[
          [t.portfolio, transaction.portfolioName],
          [t.type, transaction.type],
          [t.date, transaction.settlementDate],
          [t.security, transaction.securityLabel],
          [t.quantity, transaction.quantity],
          [t.price, transaction.unitPrice],
          [t.fees, transaction.fees],
          [t.taxes, transaction.taxes],
          [t.cash, `${Number(transaction.netAmount) >= 0 ? '+' : ''}${transaction.netAmount} MAD`],
          [
            t.inverse,
            `${Number(transaction.netAmount) <= 0 ? '+' : '-'}${Math.abs(Number(transaction.netAmount)).toFixed(6)} MAD`,
          ],
          [t.imported, transaction.importId],
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
          {locale === 'ar' ? 'تم عكس هذه العملية مسبقاً.' : 'Cette opération est déjà annulée.'}
        </p>
      ) : (
        <form className="form panel" onSubmit={(event) => void submit(event)}>
          <label htmlFor="reversal-reason">{t.reason}</label>
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
            {t.replace}
          </label>
          {withReplacement ? (
            <fieldset className="replacement-fields">
              <label>
                {t.replacementType}
                <select
                  name="replacementType"
                  value={replacementType}
                  onChange={(event) => setReplacementType(event.target.value)}
                >
                  {['deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'fee', 'tax'].map(
                    (type) => (
                      <option key={type}>{type}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                {t.replacementDate}
                <input name="replacementDate" type="date" required />
              </label>
              {['buy', 'sell'].includes(replacementType) ? (
                <>
                  <label>
                    {t.security}
                    <input name="securityId" defaultValue={transaction.securityId} required />
                  </label>
                  <label>
                    {t.quantity}
                    <input name="quantity" inputMode="decimal" pattern="\d+(\.\d+)?" required />
                  </label>
                  <label>
                    {t.price}
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
              {replacementType === 'dividend' || ['buy', 'sell'].includes(replacementType) ? (
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
            {t.confirm}
          </label>
          {failure ? <p className="error-text">{failure.message}</p> : null}
          <button
            className="button"
            disabled={busy || success || !confirmed || reason.trim().length < 8}
          >
            {t.submit}
          </button>
        </form>
      )}
      <a className="button secondary" href={`/${locale}/dashboard#transactions`}>
        {t.back}
      </a>
    </div>
  );
}
