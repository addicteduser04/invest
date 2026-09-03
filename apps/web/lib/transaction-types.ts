import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';

export type TransactionType =
  'deposit' | 'withdrawal' | 'buy' | 'sell' | 'dividend' | 'fee' | 'tax';

export const transactionTypes: TransactionType[] = [
  'deposit',
  'withdrawal',
  'buy',
  'sell',
  'dividend',
  'fee',
  'tax',
];

export const transactionTypeLabel = (
  type: TransactionType,
  locale: Locale,
  trackingMode: 'real_tracking' | 'virtual' = 'real_tracking',
) => {
  const t = getUi(locale);
  if (type === 'buy') return trackingMode === 'virtual' ? t.simulatedBuy : t.buy;
  if (type === 'sell') return trackingMode === 'virtual' ? t.simulatedSell : t.sell;
  return t[type];
};

export const transactionTypeHint = (type: TransactionType, locale: Locale) => {
  const t = getUi(locale);
  if (type === 'deposit') return t.depositHint;
  if (type === 'withdrawal') return t.withdrawalHint;
  if (type === 'buy') return t.buyHint;
  if (type === 'sell') return t.sellHint;
  if (type === 'dividend') return t.dividendHint;
  if (type === 'fee') return t.feeHint;
  return t.taxHint;
};
