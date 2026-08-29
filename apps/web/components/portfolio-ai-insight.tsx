'use client';

import { useState } from 'react';
import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';

export function PortfolioAiInsight({
  portfolioId,
  locale,
  defaultSummary,
}: {
  portfolioId: string;
  locale: Locale;
  defaultSummary: string;
}) {
  const t = getUi(locale);
  const [summary, setSummary] = useState(defaultSummary);
  const [provider, setProvider] = useState<'initial' | 'deepseek' | 'deterministic'>('initial');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/portfolios/${portfolioId}/insights`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale }),
      });
      const body = (await response.json()) as {
        summary?: string;
        provider?: 'deepseek' | 'deterministic';
        error?: string;
      };
      if (!response.ok || !body.summary)
        throw new Error(body.error ?? 'Unable to generate summary');
      setSummary(body.summary);
      setProvider(body.provider ?? 'deterministic');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to generate summary');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-insight">
      <p className="insight-text" aria-live="polite">
        {summary}
      </p>
      <button
        className="button secondary compact"
        type="button"
        disabled={busy}
        onClick={() => void generate()}
      >
        {busy ? t.generatingInsight : t.generateInsight}
      </button>
      {provider === 'deterministic' ? (
        <p className="microcopy warning-text">{t.aiFallback}</p>
      ) : null}
      {error ? (
        <p className="microcopy error-text" role="alert">
          {error}
        </p>
      ) : null}
      <p className="microcopy">{t.aiInsightDisclaimer}</p>
      <p className="microcopy">{t.aiDataDisclosure}</p>
    </div>
  );
}
