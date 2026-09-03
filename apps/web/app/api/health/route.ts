import { isMarketDateStale } from '@bvc/market-data/staleness';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface MarketDataHealthSummary {
  latestEquityDate: string | null;
  latestIndexDate: string | null;
  lastRunStatus: string | null;
  lastRunAt: string | null;
  failedInstruments: number | null;
}

async function readMarketDataHealth(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc('get_market_data_health_summary');
  if (error || !data) return null;
  const summary = data as MarketDataHealthSummary;
  const now = new Date();
  return {
    status: summary.lastRunStatus ?? 'no_previous_runs',
    latestEquityDate: summary.latestEquityDate,
    latestIndexDate: summary.latestIndexDate,
    lastRunStatus: summary.lastRunStatus,
    lastRunAt: summary.lastRunAt,
    failedInstruments: summary.failedInstruments ?? 0,
    stale: {
      equity: summary.latestEquityDate ? isMarketDateStale(summary.latestEquityDate, now) : true,
      index: summary.latestIndexDate ? isMarketDateStale(summary.latestIndexDate, now) : true,
    },
  };
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('market_security_overview')
      .select('id', { count: 'exact', head: true });
    if (error) throw error;
    const marketData = await readMarketDataHealth(supabase);
    return Response.json(
      {
        status: 'ok',
        service: 'saifinvest-web',
        database: 'reachable',
        latencyMs: Date.now() - startedAt,
        ...(marketData ? { marketData } : {}),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      {
        status: 'degraded',
        service: 'saifinvest-web',
        database: 'unreachable',
        latencyMs: Date.now() - startedAt,
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
