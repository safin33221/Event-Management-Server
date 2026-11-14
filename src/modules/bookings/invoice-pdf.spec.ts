import { describe, expect, it } from 'vitest';
import {
  buildBookingInvoicePdf,
  formatPoishaExact,
  safeHexColor,
  type BookingInvoiceReceiptData,
} from './invoice-pdf.js';

describe('invoice-pdf helper', () => {
  it('formats poisha integers cleanly without floating point drift', () => {
    expect(formatPoishaExact(1000000, 'BDT')).toBe('BDT 10,000');
    expect(formatPoishaExact(5000050, 'BDT')).toBe('BDT 50,000.50');
    expect(formatPoishaExact(5, 'BDT')).toBe('BDT 0.05');
    expect(formatPoishaExact(-250000, 'USD')).toBe('-USD 2,500');
  });

  it('validates theme hex colors safely', () => {
    expect(safeHexColor('#1a2b3c', '#111827')).toBe('#1a2b3c');
    expect(safeHexColor('invalid-color', '#111827')).toBe('#111827');
    expect(safeHexColor(undefined, '#b45309')).toBe('#b45309');
  });

  it('generates a valid multi-item PDF buffer for both studio and corporate events', async () => {
    const sample: BookingInvoiceReceiptData = {
      studio: {
        displayName: 'Softilo Demo Studio',
        tagline: 'Curated Event Production',
        logoUrl: null,
        themeTokens: {
          primaryColor: '#1e293b',
          secondaryColor: '#475569',
          accentColor: '#c2410c',
          backgroundColor: '#ffffff',
          textColor: '#0f172a',
          fontFamily: 'Inter, system-ui, sans-serif',
        },
        contactDetails: {
          phone: '+880 1711-000000',
          email: 'hello@studio.example',
          address: 'Banani, Dhaka',
        },
        timezone: 'Asia/Dhaka',
        currency: 'BDT',
      },
      booking: {
        id: 'bkg-1',
        reference: 'BKG-2026-0001',
        status: 'CONFIRMED',
        eventTitle: 'Annual Tech Summit Keynote & Awards',
        eventTypeName: 'Corporate Event',
        eventDate: new Date('2026-12-20T00:00:00.000Z'),
        clientName: 'Apex Holdings Ltd.',
        clientPhone: '+880 1800-123456',
        clientEmail: null,
        currency: 'BDT',
        agreedTotalPoisha: 5000000,
        confirmedAt: new Date('2026-11-15T08:00:00.000Z'),
        createdAt: new Date('2026-11-14T10:00:00.000Z'),
      },
      quote: {
        reference: 'QT-2026-0001',
        versionNumber: 1,
        acceptedAt: new Date('2026-11-15T07:30:00.000Z'),
        acceptedBy: 'Operations Director',
        acceptedChannel: 'EMAIL',
        terms: '50% advance due upon confirmation. Remainder on delivery.',
        subtotalPoisha: 5500000,
        discountPoisha: 500000,
        totalPoisha: 5000000,
        items: Array.from({ length: 18 }, (_, index) => ({
          id: `item-${index + 1}`,
          description: `Production Service Line ${index + 1} - Multi-camera & lighting coverage`,
          quantity: 1,
          unitPricePoisha: 250000,
          lineTotalPoisha: 250000,
        })),
      },
      ledger: {
        agreedTotalPoisha: 5000000,
        approvedCreditNotesPoisha: 0,
        effectiveAgreedChargePoisha: 5000000,
        verifiedReceiptsPoisha: 1000000,
        pendingReceiptsPoisha: 0,
        completedRefundsPoisha: 0,
        outstandingDuePoisha: 4000000,
        customerCreditPoisha: 0,
        requiredAdvancePoisha: 1000000,
        isAdvanceMet: true,
      },
      payments: [
        {
          id: 'pay-1',
          type: 'RECEIPT',
          method: 'BANK',
          amountPoisha: 1000000,
          currency: 'BDT',
          transactionRef: 'BEFTN-998877',
          verifiedAt: new Date('2026-11-15T07:50:00.000Z'),
          reason: null,
          createdAt: new Date('2026-11-15T07:45:00.000Z'),
        },
      ],
      adjustments: [],
      generatedAt: '2026-11-15T08:05:00.000Z',
    };

    const buffer = await buildBookingInvoicePdf(sample);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });
});
