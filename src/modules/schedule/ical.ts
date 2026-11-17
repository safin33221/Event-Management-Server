import { createHmac, timingSafeEqual } from 'node:crypto';

export interface IcsEventInput {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  location?: string | null;
  description?: string | null;
  status?: string;
}

export interface IcsFeedOptions {
  calendarName: string;
  timezone: string;
  events: IcsEventInput[];
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldIcsLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) {
    return line;
  }
  const chunks: string[] = [];
  let current = '';
  for (const char of line) {
    const candidate = current + char;
    const maxBytes = chunks.length === 0 ? 75 : 74;
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes) {
      chunks.push(chunks.length === 0 ? current : ` ${current}`);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    chunks.push(chunks.length === 0 ? current : ` ${current}`);
  }
  return chunks.join('\r\n');
}

export function formatIcsUtcTimestamp(date: Date): string {
  const iso = date.toISOString();
  // YYYYMMDDTHHMMSSZ
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

function mapIcsStatus(status?: string): string {
  if (status === 'CANCELLED') return 'CANCELLED';
  return 'CONFIRMED';
}

/**
 * Generates an RFC-5545 compliant iCalendar (.ics) document suitable for
 * Google Calendar subscription URLs and manual .ics imports.
 */
export function buildIcsCalendar(options: IcsFeedOptions): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Softilo Event Management//Studio Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
    `X-WR-TIMEZONE:${escapeIcsText(options.timezone || 'Asia/Dhaka')}`,
  ];

  const stamp = formatIcsUtcTimestamp(new Date());

  for (const event of options.events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.id}@softilo.events`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${formatIcsUtcTimestamp(event.startAt)}`);
    lines.push(`DTEND:${formatIcsUtcTimestamp(event.endAt)}`);
    lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
    if (event.location && event.location.trim().length > 0) {
      lines.push(`LOCATION:${escapeIcsText(event.location.trim())}`);
    }
    if (event.description && event.description.trim().length > 0) {
      lines.push(`DESCRIPTION:${escapeIcsText(event.description.trim())}`);
    }
    lines.push(`STATUS:${mapIcsStatus(event.status)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

const FEED_CONTEXT = 'softilo-google-calendar-feed-v1';

function buildFeedContext(feedKey?: string | null): string {
  const trimmed = feedKey?.trim();
  return trimmed ? `softilo-google-calendar-feed-v2:${trimmed}` : FEED_CONTEXT;
}

export function signCalendarFeedToken(secret: string, feedKey?: string | null): string {
  return createHmac('sha256', secret).update(buildFeedContext(feedKey)).digest('base64url');
}

export function verifyCalendarFeedToken(
  token: string | undefined,
  secret: string,
  feedKey?: string | null,
): boolean {
  if (!token || !secret || secret.length < 16) {
    return false;
  }
  const expected = signCalendarFeedToken(secret, feedKey);
  const actualBuf = Buffer.from(token.trim(), 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(actualBuf, expectedBuf);
}
