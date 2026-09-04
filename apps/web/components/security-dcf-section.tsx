'use client';

import React, { useMemo, useState } from 'react';
import type { Locale } from '@bvc/contracts';
import { getUi } from '@/lib/i18n';
import type { DcfHistoricalInputs } from '@/lib/dcf-inputs';
import type { DcfDefaultReference, DcfDefaults } from '@/lib/dcf-defaults';
import { runDcf, type DcfResult } from '@/lib/dcf-model';
import { buildDefaultSensitivityAxes, buildSensitivityMatrix, type SensitivityMatrix } from '@/lib/dcf-sensitivity';
import type { DcfAssumptionsInput, DcfBaseInputsInput, DcfValidationCode } from '@/lib/dcf-validation';

type ScenarioKey = 'bear' | 'base' | 'bull';
type DcfScenarioState = DcfBaseInputsInput & DcfAssumptionsInput;
type ScenarioSet = Record<ScenarioKey, DcfScenarioState>;

export interface SavedDcfScenario {
  id: string;
  name: string;
  assumptions: unknown;
  updatedAt: string;
}

export interface SecurityDcfSectionProps {
  locale: Locale;
  securityId: string;
  historicalInputs: DcfHistoricalInputs;
  defaults: DcfDefaults;
  currentPrice: { price: string | null; priceDate: string | null; stale: boolean };
  authenticated: boolean;
  initialSavedScenarios: SavedDcfScenario[];
}

type UiKey = keyof ReturnType<typeof getUi>;

const SCENARIO_KEYS: ScenarioKey[] = ['bear', 'base', 'bull'];
const SCENARIO_LABEL_KEY: Record<ScenarioKey, UiKey> = {
  bear: 'dcfScenarioBear',
  base: 'dcfScenarioBase',
  bull: 'dcfScenarioBull',
};

const ISSUE_LABEL_KEY: Record<DcfValidationCode, UiKey> = {
  MISSING_BASE_REVENUE: 'dcfIssueMissingBaseRevenue',
  MISSING_SHARES_OUTSTANDING: 'dcfIssueMissingShares',
  MISSING_WACC: 'dcfIssueMissingWacc',
  MISSING_TERMINAL_GROWTH: 'dcfIssueMissingTerminalGrowth',
  WACC_NOT_ABOVE_TERMINAL_GROWTH: 'dcfIssueWaccNotAboveTerminalGrowth',
  INVALID_FORECAST_HORIZON: 'dcfIssueInvalidForecastHorizon',
  NON_FINITE_ASSUMPTION: 'dcfIssueNonFiniteAssumption',
  NEGATIVE_SHARES: 'dcfIssueNegativeShares',
  MISSING_OPERATING_ASSUMPTION: 'dcfIssueMissingOperatingAssumption',
};

const intlLocale = (locale: Locale) => (locale === 'ar' ? 'ar-MA' : locale === 'fr' ? 'fr-MA' : 'en-MA');

const moneyPerShare = (value: number | null, locale: Locale) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency: 'MAD',
    maximumFractionDigits: 2,
  }).format(value);
};

const compactMoney = (value: number | null, locale: Locale) => {
  if (value === null || !Number.isFinite(value)) return '—';
  const formatted = new Intl.NumberFormat(intlLocale(locale), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
  return `${formatted} MAD`;
};

const percentFraction = (value: number | null, locale: Locale, signed = false) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(value);
};

const compactCount = (value: number | null, locale: Locale) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(intlLocale(locale), { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
};

function toPercentDisplay(fraction: number | null): string {
  if (fraction === null) return '';
  return String(Math.round(fraction * 100_000) / 1000);
}

function parsePercentInput(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n / 100 : null;
}

function parseNumberInput(raw: string, integer = false): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return integer ? Math.round(n) : n;
}

function PercentField({
  value,
  onChange,
  ariaLabel,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  ariaLabel: string;
}) {
  return (
    <span className="dcf-field-unit">
      <input
        type="number"
        step="0.1"
        className="dcf-input technical"
        dir="ltr"
        aria-label={ariaLabel}
        value={toPercentDisplay(value)}
        onChange={(event) => onChange(parsePercentInput(event.target.value))}
      />
      <span>%</span>
    </span>
  );
}

function NumberField({
  value,
  onChange,
  ariaLabel,
  integer,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  ariaLabel: string;
  integer?: boolean;
}) {
  return (
    <input
      type="number"
      step={integer ? 1 : 'any'}
      className="dcf-input technical"
      dir="ltr"
      aria-label={ariaLabel}
      value={value === null ? '' : String(value)}
      onChange={(event) => onChange(parseNumberInput(event.target.value, integer))}
    />
  );
}

function buildInitialScenarioState(historicalInputs: DcfHistoricalInputs, defaults: DcfDefaults): DcfScenarioState {
  const base = historicalInputs.basePeriod;
  return {
    baseRevenue: base?.revenue ?? null,
    cash: base?.cash ?? null,
    totalDebt: base?.totalDebt ?? null,
    sharesOutstanding: base?.sharesOutstanding ?? null,
    forecastYears: 5,
    revenueGrowth: defaults.revenueGrowth.value,
    ebitMargin: defaults.ebitMargin.value,
    taxRate: defaults.taxRate.value,
    daPercentRevenue: defaults.daPercentRevenue.value,
    capexPercentRevenue: defaults.capexPercentRevenue.value,
    changeNwcPercentRevenue: defaults.changeNwcPercentRevenue.value,
    wacc: null,
    terminalGrowth: null,
  };
}

interface AssumptionRow {
  key: keyof DcfAssumptionsInput;
  labelKey: UiKey;
  historical: DcfDefaultReference;
}

function isScenarioSet(value: unknown): value is { activeScenario: ScenarioKey; scenarios: ScenarioSet } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!v['scenarios'] || typeof v['scenarios'] !== 'object') return false;
  const scenarios = v['scenarios'] as Record<string, unknown>;
  return SCENARIO_KEYS.every((key) => scenarios[key] && typeof scenarios[key] === 'object');
}

export function SecurityDcfSection({
  locale,
  securityId,
  historicalInputs,
  defaults,
  currentPrice,
  authenticated,
  initialSavedScenarios,
}: SecurityDcfSectionProps) {
  const t = getUi(locale);
  const [activeScenario, setActiveScenario] = useState<ScenarioKey>('base');
  const [scenarios, setScenarios] = useState<ScenarioSet>(() => {
    const initial = buildInitialScenarioState(historicalInputs, defaults);
    return { bear: { ...initial }, base: { ...initial }, bull: { ...initial } };
  });
  const [scenarioName, setScenarioName] = useState('');
  const [savedScenarios, setSavedScenarios] = useState(initialSavedScenarios);
  const [selectedSavedId, setSelectedSavedId] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const current = scenarios[activeScenario];

  const updateField = <K extends keyof DcfScenarioState>(key: K, value: DcfScenarioState[K]) => {
    setScenarios((prev) => ({ ...prev, [activeScenario]: { ...prev[activeScenario], [key]: value } }));
  };

  const run = useMemo(() => runDcf(current, current), [current]);

  const sensitivity: SensitivityMatrix | null = useMemo(() => {
    if (!run.valid || !run.result || current.wacc === null || current.terminalGrowth === null) return null;
    const axes = buildDefaultSensitivityAxes(current.wacc, current.terminalGrowth);
    const strictBase = {
      baseRevenue: current.baseRevenue as number,
      cash: current.cash,
      totalDebt: current.totalDebt,
      sharesOutstanding: current.sharesOutstanding,
    };
    return buildSensitivityMatrix(strictBase, current, axes.waccAxis, axes.terminalGrowthAxis);
  }, [run, current]);

  const price = currentPrice.price === null ? null : Number(currentPrice.price);
  const difference =
    run.result?.valuePerShare !== null && run.result?.valuePerShare !== undefined && price !== null && price > 0
      ? run.result.valuePerShare / price - 1
      : null;

  const basePeriod = historicalInputs.basePeriod;
  const baseYearLabel = basePeriod ? `FY${basePeriod.fiscalYear}A` : t.dcfColumnBaseYear;
  const yearLabel = (year: number) => (basePeriod ? `FY${basePeriod.fiscalYear + year}E` : `${year}E`);

  const assumptionRows: AssumptionRow[] = [
    { key: 'revenueGrowth', labelKey: 'dcfRevenueGrowthLabel', historical: defaults.revenueGrowth },
    { key: 'ebitMargin', labelKey: 'fundamentalsEbitMargin', historical: defaults.ebitMargin },
    { key: 'taxRate', labelKey: 'dcfTaxRateLabel', historical: defaults.taxRate },
    { key: 'daPercentRevenue', labelKey: 'dcfDaPercentLabel', historical: defaults.daPercentRevenue },
    { key: 'capexPercentRevenue', labelKey: 'dcfCapexPercentLabel', historical: defaults.capexPercentRevenue },
    {
      key: 'changeNwcPercentRevenue',
      labelKey: 'dcfNwcPercentLabel',
      historical: defaults.changeNwcPercentRevenue,
    },
  ];

  const saveScenario = async () => {
    if (!scenarioName.trim()) return;
    setSaveStatus('saving');
    try {
      const response = await fetch('/api/dcf/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          securityId,
          name: scenarioName.trim(),
          assumptions: { activeScenario, scenarios },
        }),
      });
      if (!response.ok) throw new Error('save failed');
      const body = (await response.json()) as { scenario: SavedDcfScenario };
      setSavedScenarios((prev) => [
        body.scenario,
        ...prev.filter((s) => s.id !== body.scenario.id && s.name !== body.scenario.name),
      ]);
      setSaveStatus('saved');
      setScenarioName('');
    } catch {
      setSaveStatus('error');
    }
  };

  const loadScenario = () => {
    const saved = savedScenarios.find((s) => s.id === selectedSavedId);
    if (!saved || !isScenarioSet(saved.assumptions)) return;
    setScenarios(saved.assumptions.scenarios);
    setActiveScenario(saved.assumptions.activeScenario);
  };

  return (
    <div className="security-v2-panel dcf-section">
      <div className="security-v2-section-head">
        <div>
          <p className="public-eyebrow">{t.dcfEyebrow}</p>
          <h2>{t.dcfTitle}</h2>
        </div>
        <div className="dcf-scenario-tabs" role="tablist" aria-label={t.dcfTitle}>
          {SCENARIO_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeScenario === key}
              className={`dcf-scenario-tab${activeScenario === key ? ' active' : ''}`}
              onClick={() => setActiveScenario(key)}
            >
              {t[SCENARIO_LABEL_KEY[key]]}
            </button>
          ))}
        </div>
      </div>

      <p className="security-v2-note">{t.dcfIntro}</p>
      {!basePeriod ? <p className="security-v2-note">{t.dcfNoFundamentalsState}</p> : null}

      {run.valid && run.result ? (
        <DcfHeadline
          t={t}
          locale={locale}
          result={run.result}
          currentPrice={currentPrice}
          difference={difference}
          forecastYears={current.forecastYears}
          wacc={current.wacc}
          terminalGrowth={current.terminalGrowth}
        />
      ) : (
        <div className="dcf-issues">
          <ul>
            {run.issues
              .filter((issue) => issue.blocking)
              .map((issue) => (
                <li key={`${issue.code}-${issue.field}`}>{t[ISSUE_LABEL_KEY[issue.code]]}</li>
              ))}
          </ul>
        </div>
      )}

      <div className="dcf-assumptions">
        <h3>{t.dcfAssumptionsTitle}</h3>
        <div className="dcf-base-inputs">
          <label>
            <span>{t.dcfBaseRevenueLabel}</span>
            <NumberField
              value={current.baseRevenue}
              onChange={(v) => updateField('baseRevenue', v)}
              ariaLabel={t.dcfBaseRevenueLabel}
            />
          </label>
          <label>
            <span>{t.fundamentalsCash}</span>
            <NumberField value={current.cash} onChange={(v) => updateField('cash', v)} ariaLabel={t.fundamentalsCash} />
          </label>
          <label>
            <span>{t.fundamentalsTotalDebt}</span>
            <NumberField
              value={current.totalDebt}
              onChange={(v) => updateField('totalDebt', v)}
              ariaLabel={t.fundamentalsTotalDebt}
            />
          </label>
          <label>
            <span>{t.fundamentalsSharesOutstanding}</span>
            <NumberField
              value={current.sharesOutstanding}
              onChange={(v) => updateField('sharesOutstanding', v)}
              ariaLabel={t.fundamentalsSharesOutstanding}
            />
          </label>
          <label>
            <span>{t.dcfForecastHorizonLabel}</span>
            <NumberField
              value={current.forecastYears}
              onChange={(v) => updateField('forecastYears', v)}
              ariaLabel={t.dcfForecastHorizonLabel}
              integer
            />
          </label>
        </div>
        {basePeriod ? (
          <p className="security-v2-note dcf-base-period-note">
            {t.dcfBasePeriodLabel}: <span dir="ltr">{baseYearLabel}</span>
          </p>
        ) : null}

        <div className="dcf-assumption-grid">
          {assumptionRows.map((row) => (
            <div className="dcf-assumption-row" key={row.key}>
              <span className="dcf-assumption-label">{t[row.labelKey]}</span>
              <span className="dcf-assumption-historical">
                {t.dcfHistoricalReference}:{' '}
                <b className="technical" dir="ltr">
                  {row.historical.value === null ? t.dcfNoHistoricalReference : percentFraction(row.historical.value, locale)}
                </b>
              </span>
              <span className="dcf-assumption-forecast">
                <span>{t.dcfForecastAssumption}</span>
                <PercentField
                  value={current[row.key] as number | null}
                  onChange={(v) => updateField(row.key, v as never)}
                  ariaLabel={t[row.labelKey]}
                />
              </span>
            </div>
          ))}
          <div className="dcf-assumption-row">
            <span className="dcf-assumption-label" title={t.dcfWaccHint}>
              {t.dcfWaccLabel}
            </span>
            <span className="dcf-assumption-historical">{t.dcfWaccHint}</span>
            <span className="dcf-assumption-forecast">
              <span>{t.dcfForecastAssumption}</span>
              <PercentField value={current.wacc} onChange={(v) => updateField('wacc', v)} ariaLabel={t.dcfWaccLabel} />
            </span>
          </div>
          <div className="dcf-assumption-row">
            <span className="dcf-assumption-label" title={t.dcfTerminalGrowthHint}>
              {t.dcfTerminalGrowthLabel}
            </span>
            <span className="dcf-assumption-historical">{t.dcfTerminalGrowthHint}</span>
            <span className="dcf-assumption-forecast">
              <span>{t.dcfForecastAssumption}</span>
              <PercentField
                value={current.terminalGrowth}
                onChange={(v) => updateField('terminalGrowth', v)}
                ariaLabel={t.dcfTerminalGrowthLabel}
              />
            </span>
          </div>
        </div>
      </div>

      {run.valid && run.result ? (
        <>
          <DcfForecastTable
            t={t}
            locale={locale}
            result={run.result}
            baseYearLabel={baseYearLabel}
            yearLabel={yearLabel}
            basePeriod={basePeriod}
          />
          <DcfBridge t={t} locale={locale} result={run.result} />
          {sensitivity ? <DcfSensitivity t={t} locale={locale} matrix={sensitivity} /> : null}
        </>
      ) : null}

      {authenticated ? (
        <div className="dcf-scenarios-panel">
          <h3>{t.dcfScenariosTitle}</h3>
          <div className="dcf-scenarios-controls">
            <input
              type="text"
              className="dcf-input"
              placeholder={t.dcfScenarioNamePlaceholder}
              value={scenarioName}
              onChange={(event) => setScenarioName(event.target.value)}
              maxLength={100}
            />
            <button type="button" className="button compact" disabled={!scenarioName.trim()} onClick={() => void saveScenario()}>
              {t.dcfSaveScenario}
            </button>
          </div>
          {saveStatus === 'saved' ? <p className="success-text">{t.dcfScenarioSaved}</p> : null}
          {savedScenarios.length ? (
            <div className="dcf-scenarios-controls">
              <select
                className="dcf-input"
                value={selectedSavedId}
                onChange={(event) => setSelectedSavedId(event.target.value)}
              >
                <option value="" disabled>
                  {t.dcfScenariosTitle}
                </option>
                {savedScenarios.map((saved) => (
                  <option key={saved.id} value={saved.id}>
                    {saved.name}
                  </option>
                ))}
              </select>
              <button type="button" className="button compact" disabled={!selectedSavedId} onClick={loadScenario}>
                {t.dcfLoadScenario}
              </button>
            </div>
          ) : (
            <p className="security-v2-note">{t.dcfSavedScenariosEmpty}</p>
          )}
        </div>
      ) : (
        <p className="security-v2-note">{t.dcfSignInToSave}</p>
      )}

      <p className="security-v2-note dcf-disclaimer">{t.dcfDisclaimer}</p>
    </div>
  );
}

function DcfHeadline({
  t,
  locale,
  result,
  currentPrice,
  difference,
  forecastYears,
  wacc,
  terminalGrowth,
}: {
  t: ReturnType<typeof getUi>;
  locale: Locale;
  result: DcfResult;
  currentPrice: { price: string | null; priceDate: string | null; stale: boolean };
  difference: number | null;
  forecastYears: number | null;
  wacc: number | null;
  terminalGrowth: number | null;
}) {
  return (
    <div className="dcf-headline">
      <article>
        <span>{t.dcfHeadlineValue}</span>
        <strong className="technical" dir="ltr">
          {moneyPerShare(result.valuePerShare, locale)}
        </strong>
      </article>
      <article>
        <span>{t.dcfCurrentPriceLabel}</span>
        <strong className="technical" dir="ltr">
          {currentPrice.price === null ? t.dcfPriceUnavailable : moneyPerShare(Number(currentPrice.price), locale)}
        </strong>
        {currentPrice.stale ? <small>{t.dcfPriceStaleNote}</small> : null}
      </article>
      <article>
        <span>{t.dcfDifferenceLabel}</span>
        <strong className={`technical ${difference !== null && difference >= 0 ? 'positive' : difference !== null ? 'negative' : ''}`} dir="ltr">
          {percentFraction(difference, locale, true)}
        </strong>
      </article>
      <article>
        <span>{t.dcfWaccLabel}</span>
        <strong className="technical" dir="ltr">{percentFraction(wacc, locale)}</strong>
      </article>
      <article>
        <span>{t.dcfTerminalGrowthLabel}</span>
        <strong className="technical" dir="ltr">{percentFraction(terminalGrowth, locale)}</strong>
      </article>
      <article>
        <span>{t.dcfForecastHorizonLabel}</span>
        <strong className="technical" dir="ltr">
          {forecastYears ?? '—'} {t.dcfYearsSuffix}
        </strong>
      </article>
    </div>
  );
}

function DcfForecastTable({
  t,
  locale,
  result,
  baseYearLabel,
  yearLabel,
  basePeriod,
}: {
  t: ReturnType<typeof getUi>;
  locale: Locale;
  result: DcfResult;
  baseYearLabel: string;
  yearLabel: (year: number) => string;
  basePeriod: DcfHistoricalInputs['basePeriod'];
}) {
  return (
    <div className="dcf-forecast">
      <h3>{t.dcfForecastTableTitle}</h3>
      <div className="table-scroll">
        <table className="table dcf-forecast-table">
          <thead>
            <tr>
              <th />
              <th dir="ltr">{baseYearLabel}</th>
              {result.years.map((year) => (
                <th key={year.year} dir="ltr">
                  {yearLabel(year.year)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <ForecastRow label={t.fundamentalsRevenue} baseValue={basePeriod?.revenue ?? null} years={result.years} pick={(y) => y.revenue} format={(v) => compactMoney(v, locale)} />
            <ForecastRow label={t.dcfRowGrowth} baseValue={basePeriod?.revenueGrowth ?? null} years={result.years} pick={(y) => y.revenueGrowth} format={(v) => percentFraction(v, locale)} />
            <ForecastRow label={t.fundamentalsEbit} baseValue={basePeriod?.ebit ?? null} years={result.years} pick={(y) => y.ebit} format={(v) => compactMoney(v, locale)} />
            <ForecastRow label={t.fundamentalsEbitMargin} baseValue={basePeriod?.ebitMargin ?? null} years={result.years} pick={(y) => y.ebitMargin} format={(v) => percentFraction(v, locale)} />
            <ForecastRow label={t.dcfRowTax} baseValue={null} years={result.years} pick={(y) => y.tax} format={(v) => compactMoney(v, locale)} />
            <ForecastRow label={t.dcfRowNopat} baseValue={null} years={result.years} pick={(y) => y.nopat} format={(v) => compactMoney(v, locale)} />
            <ForecastRow label="D&A" baseValue={basePeriod?.depreciationAmortization ?? null} years={result.years} pick={(y) => y.da} format={(v) => compactMoney(v, locale)} />
            <ForecastRow label={t.dcfRowCapex} baseValue={basePeriod?.capex ?? null} years={result.years} pick={(y) => y.capex} format={(v) => compactMoney(v, locale)} />
            <ForecastRow label={t.dcfRowChangeNwc} baseValue={basePeriod?.changeInWorkingCapital ?? null} years={result.years} pick={(y) => y.changeInNwc} format={(v) => compactMoney(v, locale)} />
            <ForecastRow label={t.dcfRowFcff} baseValue={null} years={result.years} pick={(y) => y.fcff} format={(v) => compactMoney(v, locale)} />
            <ForecastRow label={t.dcfRowDiscountFactor} baseValue={null} years={result.years} pick={(y) => y.discountFactor} format={(v) => (v === null ? '—' : v.toFixed(3))} />
            <ForecastRow label={t.dcfRowPvFcff} baseValue={null} years={result.years} pick={(y) => y.presentValueFcff} format={(v) => compactMoney(v, locale)} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ForecastRow<T extends { year: number }>({
  label,
  baseValue,
  years,
  pick,
  format,
}: {
  label: string;
  baseValue: number | null;
  years: T[];
  pick: (year: T) => number | null;
  format: (value: number | null) => string;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="technical" dir="ltr">
        {baseValue === null ? '—' : format(baseValue)}
      </td>
      {years.map((year) => (
        <td key={year.year} className="technical" dir="ltr">
          {format(pick(year))}
        </td>
      ))}
    </tr>
  );
}

function DcfBridge({ t, locale, result }: { t: ReturnType<typeof getUi>; locale: Locale; result: DcfResult }) {
  return (
    <div className="dcf-bridge">
      <h3>{t.dcfBridgeTitle}</h3>
      <dl className="dcf-bridge-list">
        <div>
          <dt>{t.dcfBridgePvForecast}</dt>
          <dd className="technical" dir="ltr">{compactMoney(result.presentValueForecast, locale)}</dd>
        </div>
        <div>
          <dt title={t.dcfTerminalValueHint}>{t.dcfBridgePvTerminal}</dt>
          <dd className="technical" dir="ltr">{compactMoney(result.presentValueTerminalValue, locale)}</dd>
        </div>
        <div className="dcf-bridge-total">
          <dt title={t.dcfEnterpriseValueHint}>{t.dcfBridgeEnterpriseValue}</dt>
          <dd className="technical" dir="ltr">{compactMoney(result.enterpriseValue, locale)}</dd>
        </div>
        <div>
          <dt>{t.dcfBridgeNetDebt}</dt>
          <dd className="technical" dir="ltr">{compactMoney(result.netDebt, locale)}</dd>
        </div>
        <div className="dcf-bridge-total">
          <dt title={t.dcfEquityValueHint}>{t.dcfBridgeEquityValue}</dt>
          <dd className="technical" dir="ltr">{compactMoney(result.equityValue, locale)}</dd>
        </div>
        <div>
          <dt>{t.fundamentalsSharesOutstanding}</dt>
          <dd className="technical" dir="ltr">{compactCount(result.sharesOutstanding, locale)}</dd>
        </div>
        <div className="dcf-bridge-total">
          <dt>{t.dcfHeadlineValue}</dt>
          <dd className="technical" dir="ltr">{moneyPerShare(result.valuePerShare, locale)}</dd>
        </div>
        <div>
          <dt>{t.dcfTerminalValueShare}</dt>
          <dd className="technical" dir="ltr">{percentFraction(result.terminalValueShareOfEv, locale)}</dd>
        </div>
      </dl>
    </div>
  );
}

function DcfSensitivity({ t, locale, matrix }: { t: ReturnType<typeof getUi>; locale: Locale; matrix: SensitivityMatrix }) {
  return (
    <div className="dcf-sensitivity">
      <h3>{t.dcfSensitivityTitle}</h3>
      <p className="security-v2-note">{t.dcfSensitivityHint}</p>
      <div className="table-scroll">
        <table className="table dcf-sensitivity-table">
          <thead>
            <tr>
              <th dir="ltr">{t.dcfSensitivityWaccAxis} \ {t.dcfSensitivityGrowthAxis}</th>
              {matrix.terminalGrowthAxis.map((g) => (
                <th key={g} className="technical" dir="ltr">
                  {percentFraction(g, locale)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.waccAxis.map((wacc, rowIndex) => (
              <tr key={wacc}>
                <th scope="row" className="technical" dir="ltr">
                  {percentFraction(wacc, locale)}
                </th>
                {matrix.cells[rowIndex]!.map((cell, colIndex) => (
                  <td
                    key={colIndex}
                    className={`technical dcf-sensitivity-cell${cell.isBaseCase ? ' base-case' : ''}`}
                    dir="ltr"
                  >
                    {cell.invalid || cell.valuePerShare === null ? '—' : moneyPerShare(cell.valuePerShare, locale)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
