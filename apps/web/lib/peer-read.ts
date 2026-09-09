import { createClient } from '@/lib/supabase/server';
import { readValuationSnapshots, type ValuationSnapshot } from '@/lib/valuation-read';
import {
  computeRank,
  maximum,
  mean,
  median,
  minimum,
  percentileFromRank,
  type RankDirection,
  type RankResult,
} from '@/lib/peer-statistics';

export interface PeerSecurityMeta {
  id: string;
  ticker: string;
  name: string;
  sector: string | null;
}

/** Every ratio compared across peers, reusing valuation-read's canonical snapshot -- no
 * calculation is duplicated here. */
export type PeerMetricKey =
  | 'marketCap'
  | 'pe'
  | 'pb'
  | 'evEbitda'
  | 'dividendYield'
  | 'earningsYield'
  | 'fcfYield'
  | 'revenueGrowth'
  | 'ebitdaGrowth'
  | 'epsGrowth'
  | 'ebitdaMargin'
  | 'operatingMargin'
  | 'netMargin'
  | 'roe'
  | 'debtEquity'
  | 'netDebt';

/**
 * Purely descriptive ranking direction per metric (which value reads as "rank 1") -- this never
 * feeds into an aggregate score; each metric is shown independently.
 */
const METRIC_DIRECTIONS: Record<PeerMetricKey, RankDirection> = {
  marketCap: 'desc',
  pe: 'asc',
  pb: 'asc',
  evEbitda: 'asc',
  dividendYield: 'desc',
  earningsYield: 'desc',
  fcfYield: 'desc',
  revenueGrowth: 'desc',
  ebitdaGrowth: 'desc',
  epsGrowth: 'desc',
  ebitdaMargin: 'desc',
  operatingMargin: 'desc',
  netMargin: 'desc',
  roe: 'desc',
  debtEquity: 'asc',
  netDebt: 'asc',
};

export const PEER_METRIC_KEYS = Object.keys(METRIC_DIRECTIONS) as PeerMetricKey[];

export interface PeerMetricStat {
  /** Peer count contributing to median/min/max/mean (target excluded, nulls excluded). */
  n: number;
  median: number | null;
  min: number | null;
  max: number | null;
  mean: number | null;
  targetValue: number | null;
  /** Rank of the target among peers *and* itself -- rank.n therefore differs from `n` above. */
  rank: RankResult | null;
  percentile: number | null;
}

export interface PeerComparisonEntry extends PeerSecurityMeta {
  valuation: ValuationSnapshot;
}

export interface PeerComparison {
  target: PeerSecurityMeta;
  targetValuation: ValuationSnapshot;
  peers: PeerComparisonEntry[];
  peerCount: number;
  stats: Record<PeerMetricKey, PeerMetricStat>;
}

const isFiniteNumber = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

/**
 * Pure computation: given the target, candidate peer metadata, and an already-fetched
 * valuation snapshot for every one of them, builds the full peer comparison (statistics + rank
 * per metric). Kept separate from readPeerComparison so it is directly unit-testable without a
 * database.
 */
export function buildPeerComparison(
  target: PeerSecurityMeta,
  peerCandidates: PeerSecurityMeta[],
  valuationMap: Map<string, ValuationSnapshot>,
): PeerComparison {
  const targetValuation = valuationMap.get(target.id);
  if (!targetValuation) {
    throw new Error(`readPeerComparison: missing valuation snapshot for target ${target.id}`);
  }

  const peers: PeerComparisonEntry[] = peerCandidates
    .filter((candidate) => candidate.id !== target.id)
    .flatMap((candidate) => {
      const valuation = valuationMap.get(candidate.id);
      return valuation ? [{ ...candidate, valuation }] : [];
    });

  const stats = {} as Record<PeerMetricKey, PeerMetricStat>;
  for (const key of PEER_METRIC_KEYS) {
    const targetValue = targetValuation[key];
    const peerValues = peers.map((peer) => peer.valuation[key]).filter(isFiniteNumber);

    // Ranking pool = target (only if it has a value) + every peer that has a value. A peer
    // with a null/non-meaningful value for this metric is simply absent from the pool, never
    // treated as zero.
    const rank = isFiniteNumber(targetValue)
      ? computeRank(
          [
            { id: target.id, value: targetValue },
            ...peers
              .filter((peer) => isFiniteNumber(peer.valuation[key]))
              .map((peer) => ({ id: peer.id, value: peer.valuation[key] as number })),
          ],
          target.id,
          METRIC_DIRECTIONS[key],
        )
      : null;

    stats[key] = {
      n: peerValues.length,
      median: median(peerValues),
      min: minimum(peerValues),
      max: maximum(peerValues),
      mean: mean(peerValues),
      targetValue: isFiniteNumber(targetValue) ? targetValue : null,
      rank,
      percentile: percentileFromRank(rank),
    };
  }

  return { target, targetValuation, peers, peerCount: peers.length, stats };
}

export interface SecurityOverviewRow {
  id: string;
  ticker: string;
  name: string;
  sector: string | null;
  listing_status: string;
  is_synthetic: boolean;
  latest_close_price: string | number | null;
  latest_market_date: string | null;
}

/**
 * Default peer-candidate selection rule, kept as a pure function so it is directly unit-testable:
 * same sector as the target, active/suspended listing, non-synthetic (synthetic securities never
 * count as peers in the public product, regardless of the target), and never the target itself.
 */
export function selectPeerCandidates(
  sectorRows: SecurityOverviewRow[],
  target: SecurityOverviewRow,
): SecurityOverviewRow[] {
  if (!target.sector) return [];
  return sectorRows.filter(
    (row) =>
      row.id !== target.id &&
      row.sector === target.sector &&
      ['active', 'suspended'].includes(row.listing_status) &&
      !row.is_synthetic,
  );
}

/**
 * Canonical peer-comparison read model for one security: same sector, active/suspended listed,
 * non-synthetic, excluding the target itself. Reads only from the public
 * `market_security_overview` view and the canonical batched `readValuationSnapshots` -- no
 * separate fundamentals/valuation calculation is duplicated here, and no admin/audit columns
 * are ever selected. Returns null only when the target security itself does not exist.
 */
export async function readPeerComparison(securityId: string): Promise<PeerComparison | null> {
  const supabase = await createClient();

  const { data: targetRow } = await supabase
    .from('market_security_overview')
    .select(
      'id,ticker,name,sector,listing_status,is_synthetic,latest_close_price,latest_market_date',
    )
    .eq('id', securityId)
    .maybeSingle();
  if (!targetRow) return null;
  const target = targetRow as SecurityOverviewRow;

  let sectorRows: SecurityOverviewRow[] = [];
  if (target.sector) {
    const { data } = await supabase
      .from('market_security_overview')
      .select(
        'id,ticker,name,sector,listing_status,is_synthetic,latest_close_price,latest_market_date',
      )
      .eq('sector', target.sector);
    sectorRows = (data ?? []) as SecurityOverviewRow[];
  }
  const peerRows = selectPeerCandidates(sectorRows, target);

  const allRows = [target, ...peerRows];
  const valuationMap = await readValuationSnapshots(
    allRows.map((row) => ({
      id: row.id,
      latestPrice: row.latest_close_price,
      priceDate: row.latest_market_date,
    })),
  );

  const toMeta = (row: SecurityOverviewRow): PeerSecurityMeta => ({
    id: row.id,
    ticker: row.ticker,
    name: row.name,
    sector: row.sector,
  });

  return buildPeerComparison(toMeta(target), peerRows.map(toMeta), valuationMap);
}
