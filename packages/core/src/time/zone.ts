import { DateTime } from 'luxon';

export interface LocalToUtcResult {
  utc: Date;
  /** The local time did not exist (DST spring-forward gap) and was shifted forward. */
  shifted: boolean;
}

/**
 * Convert a wall-clock time in a brand's timezone ("2026-10-05T09:30") to UTC.
 * Scheduled times are stored in UTC; the brand timezone is only for display and input.
 */
export function localToUtc(localDateTime: string, timeZone: string): LocalToUtcResult {
  const dt = DateTime.fromISO(localDateTime, { zone: timeZone });
  if (!dt.isValid) {
    throw new Error(`Invalid date/time "${localDateTime}" in zone "${timeZone}": ${dt.invalidExplanation}`);
  }
  const requested = localDateTime.slice(11, 16);
  const shifted = dt.toFormat('HH:mm') !== requested;
  return { utc: dt.toUTC().toJSDate(), shifted };
}

export function utcToLocal(utc: Date, timeZone: string): string {
  return DateTime.fromJSDate(utc, { zone: 'utc' }).setZone(timeZone).toFormat("yyyy-MM-dd'T'HH:mm");
}

export function isValidTimeZone(timeZone: string): boolean {
  return DateTime.local().setZone(timeZone).isValid;
}
