/**
 * Converts a UTC Date instant into a YYYY-MM-DD local calendar date string
 * in the given IANA timezone (e.g. 'Asia/Dhaka').
 */
export function toAgencyLocalDate(instant: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(instant);
}

/**
 * Computes the UTC Date instant corresponding to 00:00:00.000 of a local YYYY-MM-DD
 * date in the given IANA timezone. Uses iterative offset resolution so DST or
 * half-hour timezones are handled accurately.
 */
export function localDateStartToUtc(localDate: string, timezone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) {
    throw new Error(`Invalid local date format (expected YYYY-MM-DD): ${localDate}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Start with a UTC guess at midnight
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const offsetMs = getTimezoneOffsetMs(new Date(utcGuess), timezone);
  let candidate = new Date(utcGuess - offsetMs);

  // Refine once in case of DST transition around midnight
  const refinedOffsetMs = getTimezoneOffsetMs(candidate, timezone);
  if (refinedOffsetMs !== offsetMs) {
    candidate = new Date(utcGuess - refinedOffsetMs);
  }
  return candidate;
}

/**
 * Returns [fromUtcInclusive, toUtcExclusive) for a local date range [fromDate, toDate].
 */
export function getUtcRangeForLocalDateRange(
  fromLocalDate: string,
  toLocalDate: string,
  timezone: string,
): { startUtc: Date; endUtcExclusive: Date } {
  const startUtc = localDateStartToUtc(fromLocalDate, timezone);
  const endDateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toLocalDate);
  if (!endDateParts) {
    throw new Error(`Invalid local date format (expected YYYY-MM-DD): ${toLocalDate}`);
  }
  const nextDayUtc = new Date(
    Date.UTC(Number(endDateParts[1]), Number(endDateParts[2]) - 1, Number(endDateParts[3]) + 1),
  );
  const nextLocalDate = nextDayUtc.toISOString().slice(0, 10);
  const endUtcExclusive = localDateStartToUtc(nextLocalDate, timezone);
  return { startUtc, endUtcExclusive };
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = Number(p.value);
    }
  }
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second, 0);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function isValidIanaTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
