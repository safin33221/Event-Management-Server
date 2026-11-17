import { describe, expect, it } from 'vitest';
import {
  buildIcsCalendar,
  formatIcsUtcTimestamp,
  signCalendarFeedToken,
  verifyCalendarFeedToken,
} from './ical.js';

describe('iCalendar & Google Calendar helper', () => {
  it('formats UTC timestamps and builds valid RFC-5545 VCALENDAR output', () => {
    const startAt = new Date('2026-11-18T11:00:00.000Z');
    const endAt = new Date('2026-11-18T16:30:00.000Z');
    expect(formatIcsUtcTimestamp(startAt)).toBe('20261118T110000Z');

    const ics = buildIcsCalendar({
      calendarName: 'Wedding PhotoArt Schedule',
      timezone: 'Asia/Dhaka',
      events: [
        {
          id: 'sess-123',
          title: 'Maliha & Zubayer Wedding, Main Shoot',
          startAt,
          endAt,
          location: 'Pan Pacific Sonargaon, Dhaka',
          description: 'Booking: BKG-2026-0005\nCrew: Ariful, Mehedi',
          status: 'SCHEDULED',
        },
      ],
    });

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('X-WR-TIMEZONE:Asia/Dhaka');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:sess-123@softilo.events');
    expect(ics).toContain('DTSTART:20261118T110000Z');
    expect(ics).toContain('DTEND:20261118T163000Z');
    expect(ics).toContain('SUMMARY:Maliha & Zubayer Wedding\\, Main Shoot');
    expect(ics).toContain('LOCATION:Pan Pacific Sonargaon\\, Dhaka');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('signs and verifies calendar subscription tokens in constant time', () => {
    const secret = 'test-secret-with-sufficient-length-32chars';
    const token = signCalendarFeedToken(secret);
    expect(verifyCalendarFeedToken(token, secret)).toBe(true);
    expect(verifyCalendarFeedToken('invalid-token', secret)).toBe(false);
    expect(verifyCalendarFeedToken(token, 'different-secret-with-sufficient-len')).toBe(false);

    const rotatedToken = signCalendarFeedToken(secret, 'feed-key-v2-abc');
    expect(rotatedToken).not.toBe(token);
    expect(verifyCalendarFeedToken(rotatedToken, secret, 'feed-key-v2-abc')).toBe(true);
    expect(verifyCalendarFeedToken(token, secret, 'feed-key-v2-abc')).toBe(false);
    expect(verifyCalendarFeedToken(rotatedToken, secret, 'feed-key-v3-xyz')).toBe(false);
  });
});
