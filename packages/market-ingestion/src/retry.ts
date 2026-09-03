import { BVC_SUPPORTED_INDEX_CODES } from '@bvc/market-data';
import type { StoredRun } from './store';

export interface RetryPlan {
  parentRun: StoredRun;
  tickers: string[];
  indexCodes: string[];
}

/**
 * Builds a retry plan from a prior partial/failed run's recorded instrument failures.
 * Only previously-failed tickers/index codes are included — successful instruments from
 * the parent run are never reprocessed. `scopeTickers`, if given (e.g. from --ticker(s)),
 * further narrows the retry to that subset.
 */
export function buildRetryPlan(parentRun: StoredRun, scopeTickers?: string[]): RetryPlan {
  const indexCodeSet = new Set<string>(BVC_SUPPORTED_INDEX_CODES);
  const failedTickers = new Set<string>();
  const failedIndexCodes = new Set<string>();

  for (const failure of parentRun.instrumentFailures) {
    if (failure.stage === 'index_history' && indexCodeSet.has(failure.ticker)) {
      failedIndexCodes.add(failure.ticker);
    } else if (failure.stage === 'ohlcv') {
      failedTickers.add(failure.ticker);
    }
  }

  if (!failedTickers.size && !failedIndexCodes.size) {
    throw new Error('NO_FAILED_INSTRUMENTS: the selected run has no retryable instrument failures');
  }

  let tickers = [...failedTickers];
  if (scopeTickers?.length) {
    const scoped = new Set(scopeTickers);
    tickers = tickers.filter((ticker) => scoped.has(ticker));
    if (!tickers.length && !failedIndexCodes.size) {
      throw new Error(
        'NO_MATCHING_FAILED_INSTRUMENTS: none of the requested tickers failed in that run',
      );
    }
  }

  return { parentRun, tickers, indexCodes: [...failedIndexCodes] };
}
