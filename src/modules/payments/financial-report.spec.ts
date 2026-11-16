import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard, ROLES_KEY } from '../../common/guards/auth.guard.js';
import { signAuthToken } from '../../common/crypto/jwt.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

describe('Financial Report Module (PaymentsService.getFinancialReport & RBAC)', () => {
  it('restricts GET /finance/report to OWNER and ACCOUNTANT roles only', async () => {
    const reflector = new Reflector();
    const handler = Reflect.get(
      PaymentsController.prototype,
      'getFinancialReport',
    ) as (...args: unknown[]) => unknown;
    const requiredRoles = reflector.get<string[]>(ROLES_KEY, handler);
    expect(requiredRoles).toEqual(['OWNER', 'ACCOUNTANT']);

    process.env.AUTH_SECRET = 'test-auth-secret-at-least-32-characters-long';
    const staffToken = signAuthToken(
      { sub: 'staff-1', email: 'staff@softilo.local', role: 'STAFF' },
      process.env.AUTH_SECRET,
    );

    const mockPrisma = {
      user: {
        findUnique: async () => ({
          id: 'staff-1',
          email: 'staff@softilo.local',
          role: 'STAFF',
          isActive: true,
        }),
      },
      studioSettings: {
        findUnique: async () => ({
          timezone: 'Asia/Dhaka',
          currency: 'BDT',
        }),
      },
    };

    const guard = new AuthGuard(reflector, mockPrisma as never);
    const mockContext = {
      getHandler: () => handler,
      getClass: () => PaymentsController,
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: `Bearer ${staffToken}` },
        }),
      }),
    };

    await expect(guard.canActivate(mockContext as never)).rejects.toThrow(
      new ForbiddenException('Insufficient role permissions for this action'),
    );
  });

  it('computes exact integer poisha summaries, method breakdowns, monthly trends, and receivables', async () => {
    const b1Entries = [
      {
        id: 'p-1',
        bookingId: 'b-1',
        type: 'RECEIPT',
        method: 'BKASH',
        amountPoisha: 2000000n, // Tk 20,000 verified
        currency: 'BDT',
        transactionRef: 'BKX1001',
        verificationState: 'VERIFIED',
        idempotencyKey: null,
        payloadHash: null,
        recordedById: 'u-1',
        verifiedById: 'u-1',
        verifiedAt: new Date('2026-11-10T10:00:00.000Z'),
        reason: null,
        relatedEntryId: null,
        createdAt: new Date('2026-11-10T09:00:00.000Z'),
      },
      {
        id: 'p-2',
        bookingId: 'b-1',
        type: 'RECEIPT',
        method: 'NAGAD',
        amountPoisha: 500000n, // Tk 5,000 pending
        currency: 'BDT',
        transactionRef: 'NGD2002',
        verificationState: 'PENDING',
        idempotencyKey: null,
        payloadHash: null,
        recordedById: 'u-1',
        verifiedById: null,
        verifiedAt: null,
        reason: null,
        relatedEntryId: null,
        createdAt: new Date('2026-11-12T09:00:00.000Z'),
      },
      {
        id: 'p-3',
        bookingId: 'b-1',
        type: 'REFUND',
        method: 'BANK',
        amountPoisha: 200000n, // Tk 2,000 refund
        currency: 'BDT',
        transactionRef: 'BNK3003',
        verificationState: 'VERIFIED',
        idempotencyKey: null,
        payloadHash: null,
        recordedById: 'u-1',
        verifiedById: 'u-1',
        verifiedAt: new Date('2026-11-14T09:00:00.000Z'),
        reason: 'Partial equipment discount refund',
        relatedEntryId: null,
        createdAt: new Date('2026-11-14T09:00:00.000Z'),
      },
    ];

    const mockBooking = {
      id: 'b-1',
      reference: 'BKG-2026-0001',
      eventTitle: 'Ayesha & Rafiq Wedding',
      clientName: 'Rafiq Ahmed',
      clientPhone: '+8801711000000',
      eventDate: new Date('2026-11-25T00:00:00.000Z'),
      status: 'CONFIRMED',
      createdAt: new Date('2026-11-05T08:00:00.000Z'),
      agreedTotalPoisha: 5000000n, // Tk 50,000
      advancePolicyTypeOverride: 'PERCENTAGE',
      advancePolicyValueOverride: 20n,
      eventType: { id: 'et-1', name: 'Wedding', slug: 'wedding' },
      paymentEntries: b1Entries,
      priceAdjustments: [
        {
          id: 'adj-1',
          type: 'CREDIT_NOTE',
          amountPoisha: 300000n, // Tk 3,000 credit note -> effective charge Tk 47,000
          status: 'APPROVED',
        },
      ],
    };

    const mockPrisma = {
      studioSettings: {
        findUnique: async () => ({
          currency: 'BDT',
          timezone: 'Asia/Dhaka',
          advancePolicyType: 'PERCENTAGE',
          advancePolicyValue: 20n,
        }),
      },
      booking: {
        findMany: async () => [mockBooking],
      },
      paymentEntry: {
        findMany: async () =>
          b1Entries.map((e) => ({
            ...e,
            booking: {
              id: mockBooking.id,
              reference: mockBooking.reference,
              eventTitle: mockBooking.eventTitle,
              clientName: mockBooking.clientName,
              clientPhone: mockBooking.clientPhone,
              status: mockBooking.status,
            },
          })),
      },
    };

    const service = new PaymentsService(mockPrisma as never);
    const report = await service.getFinancialReport({});

    expect(report.currency).toBe('BDT');
    expect(report.summary.totalContractedPoisha).toBe(5000000);
    expect(report.summary.effectiveContractedPoisha).toBe(4700000); // Tk 47,000 after Tk 3,000 credit note
    expect(report.summary.verifiedReceiptsPoisha).toBe(2000000); // Tk 20,000
    expect(report.summary.completedRefundsPoisha).toBe(200000); // Tk 2,000
    expect(report.summary.netCollectedRevenuePoisha).toBe(1800000); // Tk 18,000 net paid
    expect(report.summary.pendingVerificationPoisha).toBe(500000); // Tk 5,000 pending
    expect(report.summary.totalOutstandingDuePoisha).toBe(2900000); // Tk 47,000 - Tk 18,000 = Tk 29,000 due

    const bkashRow = report.byMethod.find((m) => m.method === 'BKASH');
    expect(bkashRow?.verifiedReceiptsPoisha).toBe(2000000);
    expect(bkashRow?.sharePercent).toBe(100);

    expect(report.receivables).toHaveLength(1);
    expect(report.receivables[0].outstandingDuePoisha).toBe(2900000);
    expect(report.byEventType[0].eventTypeName).toBe('Wedding');
  });
});
