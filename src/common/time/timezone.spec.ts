import {
  getUtcRangeForLocalDateRange,
  toAgencyLocalDate,
} from './timezone.js';

describe('Agency Timezone Calendar Helpers', () => {
  it('maps a session just after local midnight in Asia/Dhaka (+06:00) to the correct local date', () => {
    // 2026-11-15T18:30:00Z is 2026-11-16 00:30:00 in Asia/Dhaka
    const instant = new Date('2026-11-15T18:30:00.000Z');
    expect(toAgencyLocalDate(instant, 'Asia/Dhaka')).toBe('2026-11-16');
    expect(toAgencyLocalDate(instant, 'UTC')).toBe('2026-11-15');
  });

  it('computes UTC range for a local date range in Asia/Dhaka', () => {
    const { startUtc, endUtcExclusive } = getUtcRangeForLocalDateRange(
      '2026-11-16',
      '2026-11-16',
      'Asia/Dhaka',
    );
    expect(startUtc.toISOString()).toBe('2026-11-15T18:00:00.000Z');
    expect(endUtcExclusive.toISOString()).toBe('2026-11-16T18:00:00.000Z');
  });
});
