const TIMEZONE = 'Africa/Casablanca';

export interface StalenessCutoff {
  hour: number;
  minute: number;
}

// After the last scheduled retry window (18:05 / 18:30 / 19:30 Africa/Casablanca), a
// business day's session is expected to have been ingested.
export const DEFAULT_STALENESS_CUTOFF: StalenessCutoff = { hour: 19, minute: 30 };

interface LocalDateTime {
  isoDate: string;
  hour: number;
  minute: number;
}

function toLocalDateTime(date: Date, timeZone: string): LocalDateTime {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return {
    isoDate: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

function weekdayFromIsoDate(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

function isBusinessDay(isoDate: string): boolean {
  const weekday = weekdayFromIsoDate(isoDate);
  return weekday !== 0 && weekday !== 6;
}

function previousIsoDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! - 1)).toISOString().slice(0, 10);
}

function mostRecentBusinessDayAtOrBefore(isoDate: string): string {
  let cursor = isoDate;
  while (!isBusinessDay(cursor)) cursor = previousIsoDate(cursor);
  return cursor;
}

/**
 * The most recent trading day whose session is expected to have been ingested by `now`,
 * in Africa/Casablanca. Weekends are never themselves "expected" dates; a business day only
 * becomes expected once `now` is past the post-market cutoff.
 */
export function computeExpectedLatestMarketDate(
  now: Date,
  cutoff: StalenessCutoff = DEFAULT_STALENESS_CUTOFF,
  timeZone: string = TIMEZONE,
): string {
  const local = toLocalDateTime(now, timeZone);
  const pastCutoff =
    local.hour > cutoff.hour || (local.hour === cutoff.hour && local.minute >= cutoff.minute);
  if (pastCutoff && isBusinessDay(local.isoDate)) return local.isoDate;
  return mostRecentBusinessDayAtOrBefore(previousIsoDate(local.isoDate));
}

/**
 * Whether `latestMarketDate` (an ISO date, e.g. the latest published price/index date) is
 * older than the market date currently expected to be ingested. Callers should treat a
 * missing `latestMarketDate` as its own "no price history" state rather than passing it here.
 */
export function isMarketDateStale(
  latestMarketDate: string,
  now: Date,
  cutoff: StalenessCutoff = DEFAULT_STALENESS_CUTOFF,
  timeZone: string = TIMEZONE,
): boolean {
  return latestMarketDate < computeExpectedLatestMarketDate(now, cutoff, timeZone);
}
