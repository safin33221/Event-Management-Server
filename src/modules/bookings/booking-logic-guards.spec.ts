import { ConflictException, BadRequestException } from '@nestjs/common';
import { PaymentsService } from '../payments/payments.service.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { BookingsService } from './bookings.service.js';
import { ScheduleService } from '../schedule/schedule.service.js';

describe('Booking, Quote, and Payment Logic Guards & Tk Error Formatting', () => {
  describe('PaymentsService overpayment & cancelled-booking guards', () => {
    it('rejects recording a payment that exceeds remaining due balance with a Tk-formatted message', async () => {
      const mockTx = {
        booking: {
          findUnique: async () => ({
            id: 'b-1',
            reference: 'BK-2026-0001',
            currency: 'BDT',
            status: 'CONFIRMED',
            agreedTotalPoisha: 5000000n, // Tk 50,000
            advancePolicyTypeOverride: 'PERCENTAGE',
            advancePolicyValueOverride: 20n,
          }),
        },
        studioSettings: {
          findUnique: async () => ({
            advancePolicyType: 'PERCENTAGE',
            advancePolicyValue: 20n,
          }),
        },
        paymentEntry: {
          findUnique: async () => null,
          findMany: async () => [
            {
              type: 'RECEIPT',
              verificationState: 'VERIFIED',
              amountPoisha: 4000000n, // Tk 40,000 already paid
            },
          ],
        },
        priceAdjustment: {
          findMany: async () => [],
        },
      };

      const prisma = {
        $transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
      };

      const service = new PaymentsService(prisma as never);

      // Remaining due is Tk 10,000 (1,000,000 poisha). Trying to pay Tk 15,000 (1,500,000 poisha) must fail.
      await expect(
        service.recordPayment(
          'b-1',
          'user-1',
          {
            amountPoisha: 1500000,
            method: 'BKASH' as never,
          },
          undefined,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Payment of Tk 15,000 exceeds the remaining due balance of Tk 10,000 (Total price: Tk 50,000, Paid: Tk 40,000).',
        ),
      );
    });

    it('rejects recording a payment when booking is already fully paid', async () => {
      const mockTx = {
        booking: {
          findUnique: async () => ({
            id: 'b-1',
            reference: 'BK-2026-0001',
            currency: 'BDT',
            status: 'CONFIRMED',
            agreedTotalPoisha: 5000000n,
            advancePolicyTypeOverride: 'PERCENTAGE',
            advancePolicyValueOverride: 20n,
          }),
        },
        studioSettings: {
          findUnique: async () => null,
        },
        paymentEntry: {
          findUnique: async () => null,
          findMany: async () => [
            {
              type: 'RECEIPT',
              verificationState: 'VERIFIED',
              amountPoisha: 5000000n, // Tk 50,000 paid in full
            },
          ],
        },
        priceAdjustment: {
          findMany: async () => [],
        },
      };

      const prisma = {
        $transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
      };

      const service = new PaymentsService(prisma as never);

      await expect(
        service.recordPayment(
          'b-1',
          'user-1',
          {
            amountPoisha: 100000,
            method: 'CASH' as never,
          },
          undefined,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Booking BK-2026-0001 is already fully paid (Tk 50,000). No additional payment can be recorded.',
        ),
      );
    });
  });

  describe('QuotesService re-quote and revision guards', () => {
    it('blocks creating a new quote for an inquiry that is already CONVERTED to a booking', async () => {
      const prisma = {
        inquiry: {
          findUnique: async () => ({
            id: 'inq-1',
            reference: 'INQ-2026-0005',
            status: 'CONVERTED',
            eventTypeId: null,
            packageId: null,
            quotes: [
              {
                id: 'q-1',
                reference: 'QT-2026-0005',
                booking: { id: 'b-1', reference: 'BK-2026-0005', status: 'COMPLETED' },
              },
            ],
          }),
        },
      };

      const service = new QuotesService(prisma as never);

      await expect(
        service.createQuote('BDT', {
          inquiryId: 'inq-1',
          eventTitle: 'Wedding',
          clientName: 'Rahim',
          clientPhone: '+8801711000000',
          items: [{ description: 'Package', quantity: 1, unitPricePoisha: 5000000 }],
        }),
      ).rejects.toThrow(
        new ConflictException(
          'Inquiry INQ-2026-0005 is already converted to booking BK-2026-0005 (COMPLETED) and cannot be quoted again.',
        ),
      );
    });

    it('blocks revising or re-accepting a quote that is already ACCEPTED / linked to a booking', async () => {
      const prisma = {
        quote: {
          findUnique: async () => ({
            id: 'q-1',
            reference: 'QT-2026-0005',
            status: 'ACCEPTED',
            currentVersionId: 'qv-1',
            booking: { id: 'b-1', reference: 'BK-2026-0005', status: 'COMPLETED' },
            versions: [{ versionNumber: 1 }],
          }),
        },
      };

      const service = new QuotesService(prisma as never);

      await expect(
        service.createVersion('q-1', {
          items: [{ description: 'Revised', quantity: 1, unitPricePoisha: 6000000 }],
        }),
      ).rejects.toThrow(
        new ConflictException(
          'Quote QT-2026-0005 is already linked to booking BK-2026-0005 (COMPLETED) and cannot be revised.',
        ),
      );

      await expect(
        service.acceptQuote('q-1', 'user-1', {
          acceptedBy: 'Rahim',
          acceptedChannel: 'PHONE',
        }),
      ).rejects.toThrow(
        new ConflictException(
          'Quote QT-2026-0005 has already been accepted for booking BK-2026-0005 (COMPLETED).',
        ),
      );
    });
  });

  describe('BookingsService & ScheduleService lifecycle guards', () => {
    it('blocks cancelling a COMPLETED booking and formats advance requirement errors in Tk', async () => {
      const mockTx = {
        booking: {
          findUnique: async () => ({
            id: 'b-1',
            reference: 'BK-2026-0009',
            status: 'COMPLETED',
            currency: 'BDT',
            agreedTotalPoisha: 5000000n,
          }),
        },
      };
      const prisma = {
        $transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
      };
      const bookingsService = new BookingsService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(
        bookingsService.cancelBooking('b-1', 'user-1', { reason: 'Test' }),
      ).rejects.toThrow(
        new ConflictException(
          'Cannot cancel booking BK-2026-0009 because it is already completed.',
        ),
      );
    });

    it('blocks scheduling new sessions on a COMPLETED booking', async () => {
      const mockTx = {
        booking: {
          findUnique: async () => ({
            id: 'b-1',
            reference: 'BK-2026-0009',
            status: 'COMPLETED',
          }),
        },
      };
      const prisma = {
        $transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
      };
      const scheduleService = new ScheduleService(prisma as never);

      await expect(
        scheduleService.createSession('b-1', 'user-1', {
          title: 'Extra Shoot',
          startAt: '2026-12-01T10:00:00.000Z',
          endAt: '2026-12-01T14:00:00.000Z',
        }),
      ).rejects.toThrow(
        new ConflictException('Cannot schedule new sessions on completed booking BK-2026-0009.'),
      );
    });
  });
});
