import { describe, expect, it } from 'vitest';
import {
  assertLocalBootstrapEnvironment,
  dateRangeForYears,
  parseBootstrapArgs,
  runBvcBootstrap,
  stockHistoryWindows,
  type BootstrapOptions,
  type BvcBootstrapConnectors,
  type BvcBootstrapStore,
  type StepCounts,
} from './data-bootstrap';

const counts = (inserted = 0, updated = 0, skipped = 0): StepCounts => ({
  inserted,
  updated,
  skipped,
});

class FakeStore implements BvcBootstrapStore {
  securities = new Set<string>();
  stocks = new Set<string>();
  indices = new Set<string>();
  indexRows = new Set<string>();
  latest = new Set<string>();
  selectedTickers = ['IAM', 'ATW', 'BCP'];

  async ensureBootstrapActor() {}

  async getActiveBvcEquityTickers() {
    return this.selectedTickers;
  }

  async upsertSecurityMaster(rows: Array<{ ticker: string }>) {
    return upsertKeys(
      this.securities,
      rows.map((row) => row.ticker),
    );
  }

  async upsertIndexMaster(rows: Array<{ code: string }>) {
    return upsertKeys(
      this.indices,
      rows.map((row) => row.code),
    );
  }

  async upsertIndexHistory(rows: Array<{ code: string; marketDate: string }>) {
    return upsertKeys(
      this.indexRows,
      rows.map((row) => `${row.code}:${row.marketDate}`),
    );
  }

  async upsertStockHistory(ticker: string, rows: Array<{ marketDate: string }>) {
    return upsertKeys(
      this.stocks,
      rows.map((row) => `${ticker}:${row.marketDate}`),
    );
  }

  async upsertLatestSnapshots(
    preview: { snapshots: Array<{ ticker: string }> },
    allowedTickers: Set<string>,
    marketDate: string,
  ) {
    return upsertKeys(
      this.latest,
      preview.snapshots
        .filter((snapshot) => allowedTickers.has(snapshot.ticker))
        .map((snapshot) => `${snapshot.ticker}:${marketDate}`),
    );
  }

  async close() {}
}

describe('data bootstrap guards', () => {
  it('hard-fails unless Supabase and database URLs are local and testing is enabled', () => {
    expect(() =>
      assertLocalBootstrapEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        WORKER_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
        SUPABASE_SERVICE_ROLE_KEY: 'secret',
        BVC_PUBLIC_TESTING_ENABLED: 'true',
      }),
    ).toThrow('Supabase URL must be localhost');
    expect(() =>
      assertLocalBootstrapEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        WORKER_DATABASE_URL: 'postgresql://postgres:postgres@db.example.com:5432/postgres',
        SUPABASE_SERVICE_ROLE_KEY: 'secret',
        BVC_PUBLIC_TESTING_ENABLED: 'true',
      }),
    ).toThrow('database URL must target localhost');
    expect(() =>
      assertLocalBootstrapEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        WORKER_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
        SUPABASE_SERVICE_ROLE_KEY: 'secret',
        BVC_PUBLIC_TESTING_ENABLED: 'false',
      }),
    ).toThrow('BVC_PUBLIC_TESTING_ENABLED=true');
  });

  it('parses ticker filters and bounded year ranges', () => {
    expect(parseBootstrapArgs(['--ticker', 'iam']).tickers).toEqual(['IAM']);
    expect(parseBootstrapArgs(['--tickers', 'iam,ATW,iam']).tickers).toEqual(['IAM', 'ATW']);
    expect(() => parseBootstrapArgs(['--years', '4'])).toThrow('--years must be 1, 2, or 3');
    expect(dateRangeForYears(1, new Date('2026-08-30T12:00:00Z'))).toEqual({
      startDate: '2025-08-30',
      endDate: '2026-08-30',
    });
  });

  it('splits 3-year stock history requests into contiguous safe windows', () => {
    const windows = stockHistoryWindows('2023-08-30', '2026-08-30');
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0]?.startDate).toBe('2023-08-30');
    expect(windows.at(-1)?.endDate).toBe('2026-08-30');

    for (let index = 0; index < windows.length; index += 1) {
      const window = windows[index]!;
      const days =
        (Date.parse(`${window.endDate}T00:00:00.000Z`) -
          Date.parse(`${window.startDate}T00:00:00.000Z`)) /
        86_400_000;
      expect(days).toBeLessThanOrEqual(180);
      if (index > 0) {
        const previous = windows[index - 1]!;
        const gap =
          (Date.parse(`${window.startDate}T00:00:00.000Z`) -
            Date.parse(`${previous.endDate}T00:00:00.000Z`)) /
          86_400_000;
        expect(gap).toBe(1);
      }
    }
  });
});

describe('runBvcBootstrap', () => {
  it('filters tickers and keeps BVC stock fetches bounded to concurrency 2', async () => {
    const store = new FakeStore();
    let active = 0;
    let maxActive = 0;
    const fetched: string[] = [];
    const connectors = fakeConnectors({
      async fetchStockHistory({ ticker }) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        fetched.push(ticker);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { candidates: [stockRow(ticker, '2026-01-02')], errors: [] };
      },
    });
    const summary = await runBvcBootstrap(
      options({ tickers: ['IAM', 'BCP'] }),
      store,
      connectors,
      () => {},
    );
    expect([...new Set(fetched)].sort()).toEqual(['BCP', 'IAM']);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(summary.stockHistory.inserted).toBe(2);
  });

  it('deduplicates boundary stock-history rows across date windows', async () => {
    const store = new FakeStore();
    let previousEndDate: string | null = null;
    const requested: string[] = [];
    const connectors = fakeConnectors({
      async fetchStockHistory({ ticker, startDate, endDate }) {
        requested.push(`${startDate}..${endDate}`);
        const rows = [stockRow(ticker, startDate), stockRow(ticker, endDate)];
        if (previousEndDate) rows.unshift(stockRow(ticker, previousEndDate));
        previousEndDate = endDate;
        return { candidates: rows, errors: [] };
      },
    });

    const summary = await runBvcBootstrap(
      options({ tickers: ['IAM'], years: 3 }),
      store,
      connectors,
      () => {},
    );

    expect(requested.length).toBeGreaterThan(1);
    expect(summary.stockHistory.inserted).toBe(store.stocks.size);
    expect(summary.stockHistory.updated).toBe(0);
  });

  it('is idempotent when the store sees the same sessions again', async () => {
    const store = new FakeStore();
    const connectors = fakeConnectors();
    await runBvcBootstrap(options({ tickers: ['IAM'] }), store, connectors, () => {});
    const second = await runBvcBootstrap(
      options({ tickers: ['IAM'] }),
      store,
      connectors,
      () => {},
    );
    expect(second.securities.updated).toBeGreaterThan(0);
    expect(second.stockHistory).toEqual(counts(0, 1, 0));
    expect(second.indexHistory.inserted).toBe(0);
    expect(second.indexHistory.updated).toBeGreaterThan(0);
  });

  it('continues after a ticker failure so reruns can resume partial work', async () => {
    const store = new FakeStore();
    let failAtw = true;
    const connectors = fakeConnectors({
      async fetchStockHistory({ ticker }) {
        if (ticker === 'ATW' && failAtw) throw new Error('BVC_HTTP_502');
        return { candidates: [stockRow(ticker, '2026-01-02')], errors: [] };
      },
    });
    const first = await runBvcBootstrap(
      options({ tickers: ['IAM', 'ATW'] }),
      store,
      connectors,
      () => {},
    );
    expect(first.failures).toEqual(['ATW stock history: ATW 2026-08-27..2026-08-30: BVC_HTTP_502']);
    expect(first.stockHistory.inserted).toBe(1);
    failAtw = false;
    const second = await runBvcBootstrap(
      options({ tickers: ['IAM', 'ATW'] }),
      store,
      connectors,
      () => {},
    );
    expect(second.failures).toEqual([]);
    expect(second.stockHistory).toEqual(counts(1, 1, 0));
  });

  it('retries transient BVC fetch failures before recording a failure', async () => {
    const store = new FakeStore();
    let attempts = 0;
    const connectors = fakeConnectors({
      async fetchStockHistory({ ticker }) {
        attempts += 1;
        if (attempts === 1) throw new Error('BVC_INVALID_RESPONSE');
        return { candidates: [stockRow(ticker, '2026-01-02')], errors: [] };
      },
    });
    const summary = await runBvcBootstrap(
      options({ tickers: ['IAM'] }),
      store,
      connectors,
      () => {},
    );
    expect(attempts).toBeGreaterThan(1);
    expect(summary.failures).toEqual([]);
    expect(summary.stockHistory).toEqual(counts(1, 0, 0));
  });
});

function options(partial: Partial<BootstrapOptions> = {}): BootstrapOptions {
  return {
    years: 1,
    dryRun: false,
    concurrency: 2,
    now: new Date('2026-08-30T12:00:00Z'),
    ...partial,
  };
}

function fakeConnectors(overrides: Partial<BvcBootstrapConnectors> = {}): BvcBootstrapConnectors {
  return {
    async fetchSecurityMaster() {
      return {
        candidates: [
          {
            row: 2,
            ticker: 'IAM',
            name: 'IAM',
            sector: null,
            listingStatus: 'active',
            listedOn: null,
          },
          {
            row: 3,
            ticker: 'ATW',
            name: 'ATW',
            sector: null,
            listingStatus: 'active',
            listedOn: null,
          },
          {
            row: 4,
            ticker: 'BCP',
            name: 'BCP',
            sector: null,
            listingStatus: 'active',
            listedOn: null,
          },
        ],
        errors: [],
      };
    },
    async fetchIndexMaster() {
      return {
        candidates: [
          {
            row: 2,
            code: 'MASI',
            name: { fr: null, ar: null, en: 'MASI' },
            family: { fr: null, ar: null, en: 'MASI' },
            latestValue: null,
            previousClose: null,
            changePercent: null,
            changeYtd: null,
            high: null,
            low: null,
          },
        ],
        errors: [],
      };
    },
    async fetchIndexHistory({ code }) {
      return {
        candidates: [
          {
            row: 2,
            code,
            marketDate: '2026-01-02',
            close: '100',
            high: null,
            low: null,
            changePercent: null,
            changeYtd: null,
            sourceTimestamp: null,
            volume: null,
            transactionCount: null,
          },
        ],
        errors: [],
      };
    },
    async fetchStockHistory({ ticker }) {
      return { candidates: [stockRow(ticker, '2026-01-02')], errors: [] };
    },
    async fetchLatestMarket() {
      return {
        providerId: 'bvc_public_testing',
        sourceUrl: 'test',
        sourceHash: 'hash',
        session: { status: 'closed', timestamp: 1787871600 },
        indices: [],
        snapshots: [
          {
            ticker: 'IAM',
            price: '101',
            changePercent: null,
            volume: null,
            currency: 'MAD',
            label: { fr: null, ar: null, en: 'IAM' },
          },
        ],
        errors: [],
        warnings: [],
      };
    },
    ...overrides,
  };
}

function stockRow(ticker: string, marketDate: string) {
  return {
    row: 2,
    ticker,
    marketDate,
    close: '100',
    companyName: { fr: null, ar: null, en: ticker },
    sourceTimestamp: null,
    tradedValue: null,
    transactionCount: null,
    marketCap: null,
  };
}

function upsertKeys(target: Set<string>, keys: string[]) {
  const result = counts();
  for (const key of keys) {
    if (target.has(key)) result.updated += 1;
    else {
      target.add(key);
      result.inserted += 1;
    }
  }
  return result;
}
