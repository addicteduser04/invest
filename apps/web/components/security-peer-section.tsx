import React from 'react';
import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';
import type { PeerComparison, PeerMetricKey, PeerMetricStat } from '@/lib/peer-read';

type UiKey = keyof ReturnType<typeof getUi>;

const intlLocale = (locale: Locale) =>
  locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA';

const compactMoney = (value: number | null, locale: Locale) => {
  if (value === null || !Number.isFinite(value)) return '—';
  const formatted = new Intl.NumberFormat(intlLocale(locale), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
  return `${formatted} MAD`;
};

const percentRatio = (value: number | null, locale: Locale) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(value);
};

const ratioX = (value: number | null, locale: Locale) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }).format(value)}x`;
};

type Formatter = (value: number | null, locale: Locale) => string;

/** Bar position (0-100) for `value` across the span of every value actually in play for this
 * metric (target + peer min/max) -- never assumes the peer range alone contains the target. */
function barPosition(value: number | null, min: number | null, max: number | null): number | null {
  if (value === null) return null;
  const lo = min === null ? value : Math.min(min, value);
  const hi = max === null ? value : Math.max(max, value);
  if (hi - lo <= 0) return 50;
  return ((value - lo) / (hi - lo)) * 100;
}

function PeerBar({ stat }: { stat: PeerMetricStat }) {
  const targetPos = barPosition(stat.targetValue, stat.min, stat.max);
  const medianPos = barPosition(stat.median, stat.min, stat.max);
  if (targetPos === null) return null;
  return (
    <div className="peer-bar-track" aria-hidden="true">
      {medianPos !== null ? (
        <span className="peer-bar-median" style={{ left: `${medianPos}%` }} />
      ) : null}
      <span className="peer-bar-target" style={{ left: `${targetPos}%` }} />
    </div>
  );
}

const SUMMARY_METRICS: Array<{ key: PeerMetricKey; labelKey: UiKey; format: Formatter }> = [
  { key: 'pe', labelKey: 'valuationPe', format: ratioX },
  { key: 'evEbitda', labelKey: 'valuationEvEbitda', format: ratioX },
  { key: 'pb', labelKey: 'valuationPb', format: ratioX },
  { key: 'roe', labelKey: 'screenerRoe', format: percentRatio },
  { key: 'revenueGrowth', labelKey: 'screenerRevenueGrowth', format: percentRatio },
  { key: 'netMargin', labelKey: 'screenerNetMargin', format: percentRatio },
];

const TABLE_METRICS: Array<{ key: PeerMetricKey; labelKey: UiKey; format: Formatter }> = [
  { key: 'marketCap', labelKey: 'screenerMarketCap', format: compactMoney },
  { key: 'pe', labelKey: 'screenerPe', format: ratioX },
  { key: 'pb', labelKey: 'screenerPb', format: ratioX },
  { key: 'evEbitda', labelKey: 'screenerEvEbitda', format: ratioX },
  { key: 'revenueGrowth', labelKey: 'screenerRevenueGrowth', format: percentRatio },
  { key: 'netMargin', labelKey: 'screenerNetMargin', format: percentRatio },
  { key: 'roe', labelKey: 'screenerRoe', format: percentRatio },
  { key: 'debtEquity', labelKey: 'screenerDebtEquity', format: ratioX },
];

export function SecurityPeerSection({
  locale,
  comparison,
}: {
  locale: Locale;
  comparison: PeerComparison;
}) {
  const t = getUi(locale);
  const { target, peers, peerCount, stats } = comparison;

  if (peerCount === 0) {
    return (
      <div className="security-v2-panel">
        <div className="security-v2-section-head">
          <div>
            <p className="public-eyebrow">{t.peerEyebrow}</p>
            <h2>{t.peerTitle}</h2>
          </div>
        </div>
        <p className="security-v2-note">{target.sector ? t.peerNoPeers : t.peerNoSector}</p>
      </div>
    );
  }

  return (
    <div className="security-v2-panel">
      <div className="security-v2-section-head">
        <div>
          <p className="public-eyebrow">{t.peerEyebrow}</p>
          <h2>{t.peerTitle}</h2>
        </div>
        <span dir="ltr">
          {t.peerComparedWith} {peerCount} {t.peerListedPeers}
        </span>
      </div>

      <div className="peer-summary-grid">
        {SUMMARY_METRICS.map((metric) => {
          const stat = stats[metric.key];
          const label = t[metric.labelKey];
          return (
            <article key={metric.key} className="peer-summary-tile">
              <span>{label}</span>
              <strong className="technical" dir="ltr">
                {metric.format(stat.targetValue, locale)}
              </strong>
              <small className="technical" dir="ltr">
                {t.peerSectorMedian}: {metric.format(stat.median, locale)}
              </small>
              <PeerBar stat={stat} />
              {stat.rank ? (
                <small className="technical" dir="ltr">
                  {t.peerRank} {stat.rank.rank}/{stat.rank.n}
                </small>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="table-scroll">
        <table className="table peer-table">
          <thead>
            <tr>
              <th>{t.peerTableCompany}</th>
              <th>{t.peerTableTicker}</th>
              {TABLE_METRICS.map((metric) => (
                <th key={metric.key}>{t[metric.labelKey]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="peer-table-target-row">
              <td>
                {target.name} <small>({t.peerTargetTag})</small>
              </td>
              <td className="technical" dir="ltr">
                {target.ticker}
              </td>
              {TABLE_METRICS.map((metric) => (
                <td key={metric.key} className="technical" dir="ltr">
                  {metric.format(stats[metric.key].targetValue, locale)}
                </td>
              ))}
            </tr>
            {peers.map((peer) => (
              <tr key={peer.id}>
                <td>
                  <a href={`/${locale}/market/${peer.id}`}>{peer.name}</a>
                </td>
                <td className="technical" dir="ltr">
                  {peer.ticker}
                </td>
                {TABLE_METRICS.map((metric) => (
                  <td key={metric.key} className="technical" dir="ltr">
                    {metric.format(peer.valuation[metric.key], locale)}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="peer-table-median-row">
              <td colSpan={2}>{t.peerSectorMedian}</td>
              {TABLE_METRICS.map((metric) => (
                <td key={metric.key} className="technical" dir="ltr">
                  {metric.format(stats[metric.key].median, locale)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
