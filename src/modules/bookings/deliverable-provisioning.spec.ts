import { AcceptanceChannel, BookingStatus, QuoteStatus, QuoteVersionStatus } from '../../generated/prisma/client.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { BookingsService } from './bookings.service.js';
import {
  formatQuoteItemDeliverableLabel,
  provisionDeliverablesFromQuoteAndTemplatesTx,
} from './deliverable-provisioning.js';

describe('Deliverable Provisioning From Quote & Templates', () => {
  it('formats labels cleanly and merges quote items with category templates without duplicates', async () => {
    expect(formatQuoteItemDeliverableLabel('Edited Photos', 1)).toBe('Edited Photos');
    expect(formatQuoteItemDeliverableLabel('Printed Album', 2)).toBe('2x Printed Album');
    expect(formatQuoteItemDeliverableLabel('3x Cinematic Reels', 3)).toBe('3x Cinematic Reels');

    const createdRows: Array<{ label: string; dueAt: Date; notes: string }> = [];
    const mockTx = {
      deliverableLabel: {
        findMany: async () => [
          { label: 'Printed Album', defaultDueDays: 30, isActive: true },
          { label: 'Online Cloud Gallery', defaultDueDays: 10, isActive: true },
        ],
      },
      deliverable: {
        findMany: async () => [],
        create: async ({ data }: { data: { label: string; dueAt: Date; notes: string } }) => {
          const row = { id: `del-${createdRows.length + 1}`, ...data };
          createdRows.push(row);
          return row;
        },
      },
    };

    const eventDate = new Date('2026-12-20T00:00:00.000Z');
    const created = await provisionDeliverablesFromQuoteAndTemplatesTx(mockTx as never, {
      bookingId: 'bkg-1',
      eventTypeId: 'evt-1',
      eventDate,
      quoteItems: [
        { description: 'Printed Album', quantity: 2 },
        { description: 'Full Wedding Documentary Film', quantity: 1 },
      ],
    });

    expect(created).toHaveLength(3);
    expect(createdRows.map((r) => r.label)).toEqual([
      '2x Printed Album',
      'Full Wedding Documentary Film',
      'Online Cloud Gallery',
    ]);
    // Inherited 30-day rule from matching template
    expect(createdRows[0].dueAt.toISOString()).toBe('2027-01-19T00:00:00.000Z');
    // Default +14 days when no matching rule exists
    expect(createdRows[1].dueAt.toISOString()).toBe('2027-01-03T00:00:00.000Z');
    // Unmatched category template rule added once (+10 days)
    expect(createdRows[2].dueAt.toISOString()).toBe('2026-12-30T00:00:00.000Z');
  });

  it('auto-provisions deliverables immediately when a quote is accepted into a PENDING_CONFIRMATION booking', async () => {
    const deliverableCreates: Array<{ bookingId: string; label: string }> = [];
    const tx = {
      quoteVersion: {
        updateMany: async () => ({ count: 0 }),
        update: async () => ({
          id: 'qv-1',
          quoteId: 'quo-1',
          versionNumber: 1,
          subtotalPoisha: 4900000n,
          discountPoisha: 0n,
          totalPoisha: 4900000n,
          terms: null,
          validUntil: null,
          status: QuoteVersionStatus.ACCEPTED,
          acceptedAt: new Date(),
          acceptedBy: 'Amina Rahman',
          acceptedChannel: AcceptanceChannel.WHATSAPP,
          createdAt: new Date(),
          items: [
            {
              id: 'qi-1',
              packageId: null,
              serviceItemId: null,
              description: 'Full Wedding Photography',
              quantity: 1,
              unitPricePoisha: 3000000n,
              lineTotalPoisha: 3000000n,
              sortOrder: 0,
            },
            {
              id: 'qi-2',
              packageId: null,
              serviceItemId: null,
              description: 'Printed Hardcover Album',
              quantity: 2,
              unitPricePoisha: 950000n,
              lineTotalPoisha: 1900000n,
              sortOrder: 1,
            },
          ],
        }),
      },
      quote: {
        findUnique: async () => ({
          id: 'quo-1',
          reference: 'QUO-2026-0023',
          inquiryId: null,
          eventTypeId: null,
          eventTitle: 'Amina & Tariq Wedding Reception',
          requestedDate: new Date('2026-12-20T00:00:00.000Z'),
          clientName: 'Amina Rahman',
          clientPhone: '+8801711000011',
          clientEmail: null,
          currency: 'BDT',
          status: QuoteStatus.SENT,
          currentVersionId: 'qv-1',
          booking: null,
        }),
        update: async () => ({}),
      },
      quoteVersionLookup: {},
      booking: {
        create: async () => ({
          id: 'bkg-23',
          reference: 'BKG-2026-0023',
          agreedTotalPoisha: 4900000n,
          status: BookingStatus.PENDING_CONFIRMATION,
        }),
      },
      deliverableLabel: { findMany: async () => [] },
      deliverable: {
        findMany: async () => [],
        create: async ({ data }: { data: { bookingId: string; label: string } }) => {
          deliverableCreates.push(data);
          return { id: `del-${deliverableCreates.length}`, ...data };
        },
      },
      auditLog: { create: async () => ({}) },
    };

    const prisma = {
      quote: tx.quote,
      quoteVersion: {
        findFirst: async () => ({
          id: 'qv-1',
          quoteId: 'quo-1',
          status: QuoteVersionStatus.SENT,
        }),
      },
      nextReference: async () => 'BKG-2026-0023',
      $transaction: async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx),
    };

    const quotesService = new QuotesService(prisma as never);
    await quotesService.acceptQuote('quo-1', 'user-1', {
      acceptedBy: 'Amina Rahman',
      acceptedChannel: AcceptanceChannel.WHATSAPP,
    });

    expect(deliverableCreates.map((d) => d.label)).toEqual([
      'Full Wedding Photography',
      '2x Printed Hardcover Album',
    ]);
  });

  it('auto-backfills deliverables when viewing an existing PENDING_CONFIRMATION booking with 0 deliverables', async () => {
    const created: Array<Record<string, unknown>> = [];
    const tx = {
      booking: {
        findUnique: async () => ({
          id: 'bkg-existing',
          reference: 'BKG-2026-0023',
          status: BookingStatus.PENDING_CONFIRMATION,
          eventTypeId: null,
          eventDate: new Date('2026-12-20T00:00:00.000Z'),
          agreedTotalPoisha: 4900000n,
          advancePolicyValueOverride: null,
          acceptedQuoteVersion: {
            id: 'qv-23',
            subtotalPoisha: 4900000n,
            discountPoisha: 0n,
            totalPoisha: 4900000n,
            items: [
              {
                id: 'qi-1',
                description: 'Wedding Highlight Reel',
                quantity: 1,
                unitPricePoisha: 4900000n,
                lineTotalPoisha: 4900000n,
                sortOrder: 0,
              },
            ],
          },
          sessions: [],
          deliverables: [],
          assignments: [],
        }),
      },
      studioSettings: { findUnique: async () => ({ timezone: 'Asia/Dhaka' }) },
      scheduleAuditLog: { findMany: async () => [] },
      deliverableLabel: { findMany: async () => [] },
      deliverable: {
        findMany: async () => [],
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: 'del-auto-1',
            assigneeUserId: null,
            reviewStatus: 'PENDING',
            deliveredAt: null,
            deliveryUrl: null,
            ...data,
          };
          created.push(row);
          return row;
        },
      },
    };

    const prisma = {
      $transaction: async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx),
    };
    const paymentsService = {
      computeLedgerSummaryTx: async () => ({
        agreedTotalPoisha: 4900000,
        verifiedReceiptsPoisha: 0,
        pendingReceiptsPoisha: 0,
        requiredAdvancePoisha: 980000,
        isAdvanceMet: false,
      }),
    };
    const bookingsService = new BookingsService(
      prisma as never,
      paymentsService as never,
      {} as never,
      {} as never,
    );

    const result = await bookingsService.getBooking('bkg-existing');
    expect(created).toHaveLength(1);
    expect(result.deliverables).toHaveLength(1);
    expect(result.deliverables[0].label).toBe('Wedding Highlight Reel');
  });
});
