import { describe, expect, it } from 'vitest';
import { AdminCsvProvider } from './index';

describe('administrator CSV provider', () => {
  it('maps common TradingView-style columns without claiming a licensed source', async () => {
    const csv =
      'time,symbol,open,high,low,close,volume\n2026-01-02T00:00:00Z,IAM,100,102,99,101.5,2000';
    const preview = await new AdminCsvProvider().preview(csv, {
      date: 'time',
      ticker: 'symbol',
      close: 'close',
      open: 'open',
      high: 'high',
      low: 'low',
      volume: 'volume',
    });
    expect(preview.errors).toEqual([]);
    expect(preview.candidates[0]?.close).toBe('101.5');
    expect(preview.sourceHash).toHaveLength(64);
  });
  it('detects duplicate instrument dates', async () => {
    const csv = 'date,ticker,close\n2026-01-02,IAM,101\n2026-01-02,IAM,102';
    const preview = await new AdminCsvProvider().preview(csv, {
      date: 'date',
      ticker: 'ticker',
      close: 'close',
    });
    expect(preview.errors.some((error) => error.includes('duplicate'))).toBe(true);
  });
});

describe('security master CSV preview', () => {
  it('normalizes valid reference rows without inventing fields', async () => {
    const { previewSecurityMasterCsv } = await import('./index');
    const result = previewSecurityMasterCsv(
      'ticker,name,sector,listing_status,listed_on\niam,Maroc Telecom,Télécoms,active,2004-12-13\n',
    );
    expect(result.errors).toEqual([]);
    expect(result.candidates).toEqual([
      {
        row: 2,
        ticker: 'IAM',
        name: 'Maroc Telecom',
        sector: 'Télécoms',
        listingStatus: 'active',
        listedOn: '2004-12-13',
      },
    ]);
  });

  it('preserves optional BVC security-master metadata from normalized CSV', async () => {
    const { previewSecurityMasterCsv } = await import('./index');
    const result = previewSecurityMasterCsv(
      'ticker,name,sector,listing_status,listed_on,isin,issuer_name,instrument_type,market_segment,share_count,source_id\nIAM,Maroc Telecom,Télécoms,active,,MA0000011488,ITISSALAT AL-MAGHRIB,Actions,Principal,879095340,IAM\n',
    );
    expect(result.errors).toEqual([]);
    expect(result.candidates[0]).toMatchObject({
      ticker: 'IAM',
      isin: 'MA0000011488',
      issuerName: 'ITISSALAT AL-MAGHRIB',
      instrumentType: 'Actions',
      marketSegment: 'Principal',
      shareCount: '879095340',
      sourceId: 'IAM',
    });
  });

  it('rejects duplicate and malformed tickers', async () => {
    const { previewSecurityMasterCsv } = await import('./index');
    const result = previewSecurityMasterCsv('ticker,name\nBAD TICKER,One\nIAM,Two\nIAM,Three\n');
    expect(result.errors.some((error) => error.includes('invalid ticker'))).toBe(true);
    expect(result.errors.some((error) => error.includes('duplicate ticker IAM'))).toBe(true);
  });
});

describe('market-data guardrails', () => {
  it('rejects impossible OHLC relationships', async () => {
    const preview = await new AdminCsvProvider().preview(
      'date,ticker,open,high,low,close\n2026-01-02,IAM,100,99,98,101',
      { date: 'date', ticker: 'ticker', close: 'close', open: 'open', high: 'high', low: 'low' },
    );
    expect(preview.errors.some((error) => error.includes('high is below'))).toBe(true);
  });

  it('warns about unusually large close-to-close moves instead of silently publishing them', async () => {
    const preview = await new AdminCsvProvider().preview(
      'date,ticker,close\n2026-01-02,IAM,100\n2026-01-03,IAM,150',
      { date: 'date', ticker: 'ticker', close: 'close' },
    );
    expect(preview.errors).toEqual([]);
    expect(preview.warnings.some((warning) => warning.includes('more than 30%'))).toBe(true);
  });
});

describe('market-data calendar validation', () => {
  it('rejects impossible calendar dates before they can reach PostgreSQL casts', async () => {
    const preview = await new AdminCsvProvider().preview('date,ticker,close\n2026-02-31,IAM,100', {
      date: 'date',
      ticker: 'ticker',
      close: 'close',
    });
    expect(preview.errors.some((error) => error.includes('invalid date'))).toBe(true);
  });

  it('rejects impossible listed_on dates in the security master', async () => {
    const { previewSecurityMasterCsv } = await import('./index');
    const preview = previewSecurityMasterCsv(
      'ticker,name,listing_status,listed_on\nIAM,Maroc Telecom,active,2026-02-31\n',
    );
    expect(preview.errors.some((error) => error.includes('invalid listed_on date'))).toBe(true);
  });
});

describe('market-data malformed CSV handling', () => {
  it('returns validation errors instead of throwing on malformed price CSV', async () => {
    const preview = await new AdminCsvProvider().preview('date,ticker,close\n"2026-01-02,IAM,100', {
      date: 'date',
      ticker: 'ticker',
      close: 'close',
    });
    expect(preview.errors.some((error) => error.includes('malformed'))).toBe(true);
    expect(preview.candidates).toEqual([]);
  });

  it('returns validation errors instead of throwing on malformed security-master CSV', async () => {
    const { previewSecurityMasterCsv } = await import('./index');
    const preview = previewSecurityMasterCsv('ticker,name\n"IAM,Maroc Telecom');
    expect(preview.errors.some((error) => error.includes('malformed'))).toBe(true);
    expect(preview.candidates).toEqual([]);
  });
});

describe('BVC public historical testing adapter', () => {
  it('normalizes captured BVC OHLCV sessions without trusting the UTC timestamp as the trading date', async () => {
    const { previewBvcHistoricalPayload } = await import('./index');
    const preview = previewBvcHistoricalPayload(
      {
        totalCount: 2,
        items: [
          {
            seance: '28/08/2026',
            timestamp: 1787871600000,
            symbol: 'IAM',
            libelle: {
              fr: 'ITISSALAT AL-MAGHRIB',
              ar: 'إتصالات المغرب',
              en: 'ITISSALAT AL-MAGHRIB',
            },
            ouverture: 103.2,
            dernierCours: 102.75,
            coursReference: null,
            plusHaut: 103.55,
            plusBas: 102.75,
            titresEchanges: 384665,
            volumeEchanges: 39720728.2,
            nbTransactions: 213,
            capitalisation: 90327046185,
            variation: null,
            emetteur: '',
            statut: { fr: '', ar: '', en: '' },
            mode_cotation: { fr: '', ar: '', en: '' },
          },
          {
            seance: '27/08/2026',
            timestamp: 1787785200000,
            symbol: 'IAM',
            libelle: {
              fr: 'ITISSALAT AL-MAGHRIB',
              ar: 'إتصالات المغرب',
              en: 'ITISSALAT AL-MAGHRIB',
            },
            ouverture: 103,
            dernierCours: 103.2,
            plusHaut: 103.2,
            plusBas: 102.6,
            titresEchanges: 257235,
            volumeEchanges: 26524321,
            nbTransactions: 270,
            capitalisation: 90722639088,
          },
        ],
      },
      'IAM',
    );

    expect(preview.errors).toEqual([]);
    expect(preview.candidates).toHaveLength(2);
    expect(preview.candidates[0]?.marketDate).toBe('2026-08-28');
    expect(preview.candidates[0]?.close).toBe('102.75');
    expect(preview.candidates[0]?.volume).toBe('384665');
    expect(preview.candidates[0]?.marketCap).toBe('90327046185');
    expect(preview.csv).toContain('2026-08-28,IAM,103.2,103.55,102.75,102.75,384665');
    expect(preview.warnings[0]).toContain('private/staging testing only');
  });

  it('deduplicates overlapping BVC chart windows by ticker and session date', async () => {
    const { previewBvcHistoricalPayload } = await import('./index');
    const item = {
      seance: '07/07/2025',
      timestamp: 1751842800000,
      symbol: 'IAM',
      libelle: { fr: 'ITISSALAT AL-MAGHRIB', ar: '', en: 'ITISSALAT AL-MAGHRIB' },
      ouverture: 114.6,
      dernierCours: 118.5,
      plusHaut: 123.25,
      plusBas: 114,
      titresEchanges: 707347,
      volumeEchanges: 84211729.3,
      nbTransactions: 485,
      capitalisation: 104172797790,
    };
    const preview = previewBvcHistoricalPayload({ totalCount: 2, items: [item, item] }, 'IAM');
    expect(preview.candidates).toHaveLength(1);
    expect(preview.warnings.some((warning) => warning.includes('deduplicated'))).toBe(true);
  });

  it('keeps the connector bounded to one testing-sized request', async () => {
    const { fetchBvcHistoricalPreview } = await import('./index');
    await expect(
      fetchBvcHistoricalPreview({
        instrument: 'IAM',
        startDate: '2025-01-01',
        endDate: '2026-08-28',
      }),
    ).rejects.toThrow('BVC_DATE_RANGE_TOO_LARGE');
  });

  it('fetches up to three years through multiple bounded windows without duplicate sessions', async () => {
    const { fetchBvcHistoricalRangePreview } = await import('./index');
    const requested: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requested.push(url.toString());
      const date = url.searchParams.get('endDate') ?? '2026-08-28';
      const [year, month, day] = date.split('-');
      return new Response(
        JSON.stringify({
          totalCount: 1,
          items: [
            {
              seance: `${day}/${month}/${year}`,
              symbol: 'IAM',
              ouverture: 100,
              dernierCours: 101,
              plusHaut: 102,
              plusBas: 99,
              titresEchanges: 1000,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const preview = await fetchBvcHistoricalRangePreview(
      { instrument: 'IAM', startDate: '2025-01-01', endDate: '2026-08-28' },
      mockFetch,
    );
    expect(requested.length).toBeGreaterThan(1);
    expect(preview.errors).toEqual([]);
    expect(preview.candidates).toHaveLength(requested.length);
    expect(preview.warnings.some((warning) => warning.includes('bounded request windows'))).toBe(
      true,
    );
  });

  it('returns a stable error when BVC responds with invalid JSON', async () => {
    const { fetchBvcHistoricalPreview } = await import('./index');
    const mockFetch: typeof fetch = async () =>
      new Response('<html>upstream error</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });

    await expect(
      fetchBvcHistoricalPreview(
        { instrument: 'IAM', startDate: '2026-08-01', endDate: '2026-08-28' },
        mockFetch,
      ),
    ).rejects.toThrow('BVC_INVALID_RESPONSE');
  });

  it('builds a bounded first-party BVC request and normalizes the returned session', async () => {
    const { fetchBvcHistoricalPreview } = await import('./index');
    let requestedUrl = '';
    const mockFetch: typeof fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          totalCount: 1,
          items: [
            {
              seance: '28/08/2026',
              timestamp: 1787871600000,
              symbol: 'IAM',
              libelle: { fr: 'ITISSALAT AL-MAGHRIB', ar: '', en: 'ITISSALAT AL-MAGHRIB' },
              ouverture: 103.2,
              dernierCours: 102.75,
              plusHaut: 103.55,
              plusBas: 102.75,
              titresEchanges: 384665,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const preview = await fetchBvcHistoricalPreview(
      { instrument: 'iam', startDate: '2026-07-29', endDate: '2026-08-28' },
      mockFetch,
    );
    const url = new URL(requestedUrl);
    expect(url.hostname).toBe('www.casablanca-bourse.com');
    expect(url.pathname).toBe('/api/boursenova/stock-historical');
    expect(url.searchParams.get('instrument')).toBe('IAM');
    expect(url.searchParams.get('pageSize')).toBe('1000');
    expect(preview.candidates[0]?.marketDate).toBe('2026-08-28');
  });
});

describe('BVC public security master testing adapter', () => {
  it('extracts the BVC actions security master from Drupal settings HTML', async () => {
    const { previewBvcSecurityMasterHtml } = await import('./index');
    const html = `<html><script type="application/json" data-drupal-selector="drupal-settings-json">${JSON.stringify(
      {
        boursenova: {
          actions: [
            {
              id: 'IAM',
              ticker: 'IAM',
              codeISIN: 'MA0000011488',
              emetteur: 'ITISSALAT AL-MAGHRIB',
              instrument: 'ITISSALAT AL-MAGHRIB',
              categorie: 'Actions',
              compartiment: 'Principal',
              nombreTitres: '879 095 340',
              secteur: 'Telecommunications',
            },
          ],
        },
      },
    )}</script></html>`;

    const preview = previewBvcSecurityMasterHtml(html);
    expect(preview.errors).toEqual([]);
    expect(preview.candidates[0]).toMatchObject({
      ticker: 'IAM',
      name: 'ITISSALAT AL-MAGHRIB',
      isin: 'MA0000011488',
      sector: 'Telecommunications',
      shareCount: '879095340',
      sourceId: 'IAM',
    });
    expect(preview.csv).toContain('ticker,name,sector,listing_status');
    expect(preview.warnings[0]).toContain('redistribution rights');
  });

  it('returns a stable error when BVC actions settings are missing', async () => {
    const { previewBvcSecurityMasterSettings } = await import('./index');
    const preview = previewBvcSecurityMasterSettings({ boursenova: {} });
    expect(preview.errors).toContain(
      'BVC security master settings did not match the expected schema',
    );
    expect(preview.candidates).toEqual([]);
  });
});

describe('BVC public index testing adapter', () => {
  it('normalizes supported MASI index definitions from captured settings', async () => {
    const { previewBvcIndexSettings } = await import('./index');
    const preview = previewBvcIndexSettings({
      boursenova: {
        indices: {
          main: [
            {
              code: 'MASI',
              value: 18931.0597,
              previous_close: 19046.9191,
              change_pct: -0.6082842028,
              change_ytd: 0.44947,
              high: 19118.0006,
              low: 18931.0597,
              label: { fr: 'MASI', ar: 'MASI', en: 'MASI' },
              type_label: { fr: 'Principal', ar: 'Principal', en: 'Main' },
            },
            { code: 'UNSUPPORTED', label: { en: 'Nope' } },
          ],
          grouped_others: {
            main: [
              {
                code: 'MSI20',
                value: 1543.12,
                label: { en: 'MASI 20' },
                type_label: { en: 'Main' },
              },
            ],
          },
        },
      },
    });
    expect(preview.errors).toEqual([]);
    expect(preview.candidates.map((candidate) => candidate.code)).toEqual(['MASI', 'MSI20']);
    expect(preview.candidates[0]?.latestValue).toBe('18931.0597');
  });

  it('normalizes captured MASI historical observations without using UTC timestamps as dates', async () => {
    const { previewBvcIndexHistoryPayload } = await import('./index');
    const preview = previewBvcIndexHistoryPayload(
      {
        totalCount: 1,
        items: [
          {
            seance: '28/08/2026',
            timestamp: 1787871600000,
            indices: {
              MASI: {
                code: 'MASI',
                libelle: { fr: 'MASI', ar: 'MASI', en: 'MASI' },
                valeur: 18931.0597,
                variation: -0.6082842028,
                plusHaut: 19118.0006,
                plusBas: 18931.0597,
                variationYTD: 0.44947,
              },
            },
            volume: 0,
            transactions: 0,
          },
        ],
      },
      'MASI',
    );

    expect(preview.errors).toEqual([]);
    expect(preview.candidates[0]).toMatchObject({
      code: 'MASI',
      marketDate: '2026-08-28',
      close: '18931.0597',
      high: '19118.0006',
      low: '18931.0597',
      changePercent: '-0.6082842028',
    });
    expect(preview.csv).toContain('2026-08-28,MASI,19118.0006,18931.0597,18931.0597');
  });

  it('keeps index fetches bounded to supported BVC codes and ranges', async () => {
    const { fetchBvcIndexHistoryPreview } = await import('./index');
    await expect(fetchBvcIndexHistoryPreview({ code: 'ALLSHARES' })).rejects.toThrow(
      'UNSUPPORTED_BVC_INDEX',
    );
    await expect(
      fetchBvcIndexHistoryPreview({
        code: 'MASI',
        startDate: '2020-01-01',
        endDate: '2026-08-28',
      }),
    ).rejects.toThrow('BVC_INDEX_DATE_RANGE_TOO_LARGE');
  });

  it('builds the confirmed first-party MASI historical endpoint', async () => {
    const { fetchBvcIndexHistoryPreview } = await import('./index');
    let requestedUrl = '';
    const mockFetch: typeof fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ totalCount: 0, items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    await fetchBvcIndexHistoryPreview({ code: 'masi', period: '1m' }, mockFetch);
    const url = new URL(requestedUrl);
    expect(url.hostname).toBe('www.casablanca-bourse.com');
    expect(url.pathname).toBe('/api/boursenova/indices/historical');
    expect(url.searchParams.get('code')).toBe('MASI');
    expect(url.searchParams.get('period')).toBe('1m');
  });

  it('normalizes latest available BVC snapshots as delayed/public-site data only', async () => {
    const { previewBvcLatestMarketHtml } = await import('./index');
    const html = `<script data-drupal-selector="drupal-settings-json" type="application/json">${JSON.stringify(
      {
        live_market: {
          indices: {
            principaux: [{ code: 'MASI', value: 18931.0597, label: { en: 'MASI' } }],
            all: [],
          },
          ticker: {
            items: [
              {
                symbol: 'IAM',
                price: 102.75,
                change_pct: -0.43,
                volume: 384665,
                currency: 'MAD',
                label: { en: 'ITISSALAT AL-MAGHRIB' },
              },
            ],
          },
          session: { status: 'closed', timestamp: 1787871600 },
        },
      },
    )}</script>`;
    const preview = previewBvcLatestMarketHtml(html);
    expect(preview.errors).toEqual([]);
    expect(preview.session).toEqual({ status: 'closed', timestamp: 1787871600 });
    expect(preview.indices[0]?.code).toBe('MASI');
    expect(preview.snapshots[0]).toMatchObject({
      ticker: 'IAM',
      price: '102.75',
      currency: 'MAD',
    });
    expect(preview.warnings[0]).toContain('latest available/delayed');
  });
});
