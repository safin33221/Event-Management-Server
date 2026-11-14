import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdjustmentStatus,
  AdjustmentType,
  AdvancePolicyType,
  PaymentEntry,
  PaymentType,
  Prisma,
  VerificationState,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { hashIdempotencyPayload } from '../../common/crypto/hash.js';
import {
  computeRequiredAdvancePoisha,
  sumPoisha,
  toJsonPoisha,
  toPoisha,
} from '../../common/money/money.js';
import {
  CreateAdjustmentDto,
  IssueRefundDto,
  RecordPaymentDto,
} from './dto/payments.dto.js';

export interface BookingLedgerSummary {
  bookingId: string;
  currency: string;
  agreedTotalPoisha: number;
  approvedCreditNotesPoisha: number;
  effectiveAgreedChargePoisha: number;
  verifiedReceiptsPoisha: number;
  pendingReceiptsPoisha: number;
  completedRefundsPoisha: number;
  outstandingDuePoisha: number;
  customerCreditPoisha: number;
  requiredAdvancePoisha: number;
  isAdvanceMet: boolean;
}

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  private serializeEntry(entry: PaymentEntry) {
    return {
      id: entry.id,
      bookingId: entry.bookingId,
      type: entry.type,
      method: entry.method,
      amountPoisha: toJsonPoisha(entry.amountPoisha),
      currency: entry.currency,
      transactionRef: entry.transactionRef,
      verificationState: entry.verificationState,
      idempotencyKey: entry.idempotencyKey,
      recordedById: entry.recordedById,
      verifiedById: entry.verifiedById,
      verifiedAt: entry.verifiedAt,
      reason: entry.reason,
      relatedEntryId: entry.relatedEntryId,
      createdAt: entry.createdAt,
    };
  }

  async computeLedgerSummaryTx(
    tx: Prisma.TransactionClient,
    bookingId: string,
  ): Promise<BookingLedgerSummary> {
    const [booking, studio] = await Promise.all([
      tx.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          currency: true,
          agreedTotalPoisha: true,
          advancePolicyTypeOverride: true,
          advancePolicyValueOverride: true,
        },
      }),
      tx.studioSettings.findUnique({
        where: { id: 'default' },
        select: { advancePolicyType: true, advancePolicyValue: true },
      }),
    ]);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    const policyType =
      booking.advancePolicyTypeOverride ?? studio?.advancePolicyType ?? AdvancePolicyType.PERCENTAGE;
    const policyValue = booking.advancePolicyValueOverride ?? studio?.advancePolicyValue ?? 20n;
    const requiredAdvance = computeRequiredAdvancePoisha(
      booking.agreedTotalPoisha,
      policyType,
      policyValue,
    );

    const [entries, adjustments] = await Promise.all([
      tx.paymentEntry.findMany({
        where: { bookingId },
        select: { type: true, verificationState: true, amountPoisha: true },
      }),
      tx.priceAdjustment.findMany({
        where: { bookingId, status: AdjustmentStatus.APPROVED },
        select: { type: true, amountPoisha: true },
      }),
    ]);

    const verifiedReceipts = sumPoisha(
      entries
        .filter(
          (e) =>
            e.type === PaymentType.RECEIPT &&
            e.verificationState === VerificationState.VERIFIED,
        )
        .map((e) => e.amountPoisha),
    );
    const pendingReceipts = sumPoisha(
      entries
        .filter(
          (e) =>
            e.type === PaymentType.RECEIPT &&
            e.verificationState === VerificationState.PENDING,
        )
        .map((e) => e.amountPoisha),
    );
    const completedRefunds = sumPoisha(
      entries
        .filter(
          (e) =>
            e.type === PaymentType.REFUND &&
            e.verificationState === VerificationState.VERIFIED,
        )
        .map((e) => e.amountPoisha),
    );

    const approvedCreditNotes = sumPoisha(
      adjustments
        .filter((a) => a.type === AdjustmentType.CREDIT_NOTE)
        .map((a) => a.amountPoisha),
    );

    const chargeAdditions = sumPoisha(
      adjustments
        .filter((a) => a.type === AdjustmentType.CHARGE_ADJUSTMENT)
        .map((a) => a.amountPoisha),
    );

    const effectiveAgreedCharge =
      booking.agreedTotalPoisha - approvedCreditNotes + chargeAdditions;
    const rawBalance = effectiveAgreedCharge - verifiedReceipts + completedRefunds;

    const outstandingDue = rawBalance > 0n ? rawBalance : 0n;
    const customerCredit = rawBalance < 0n ? -rawBalance : 0n;

    return {
      bookingId: booking.id,
      currency: booking.currency,
      agreedTotalPoisha: toJsonPoisha(booking.agreedTotalPoisha),
      approvedCreditNotesPoisha: toJsonPoisha(approvedCreditNotes),
      effectiveAgreedChargePoisha: toJsonPoisha(effectiveAgreedCharge),
      verifiedReceiptsPoisha: toJsonPoisha(verifiedReceipts),
      pendingReceiptsPoisha: toJsonPoisha(pendingReceipts),
      completedRefundsPoisha: toJsonPoisha(completedRefunds),
      outstandingDuePoisha: toJsonPoisha(outstandingDue),
      customerCreditPoisha: toJsonPoisha(customerCredit),
      requiredAdvancePoisha: toJsonPoisha(requiredAdvance),
      isAdvanceMet: verifiedReceipts >= requiredAdvance,
    };
  }

  async getBookingLedger(bookingId: string) {
    return this.prisma.$transaction(async (tx) => {
      const summary = await this.computeLedgerSummaryTx(tx, bookingId);
      const [entries, adjustments] = await Promise.all([
        tx.paymentEntry.findMany({
          where: { bookingId },
          orderBy: { createdAt: 'asc' },
        }),
        tx.priceAdjustment.findMany({
          where: { bookingId },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

      return {
        summary,
        entries: entries.map((e) => this.serializeEntry(e)),
        adjustments: adjustments.map((a) => ({
          ...a,
          amountPoisha: toJsonPoisha(a.amountPoisha),
        })),
      };
    });
  }

  async recordPayment(
    bookingId: string,
    actorId: string,
    dto: RecordPaymentDto,
    headerIdempotencyKey?: string,
  ) {
    const idempotencyKey = dto.idempotencyKey ?? headerIdempotencyKey ?? null;
    const payloadHash = hashIdempotencyPayload({
      bookingId,
      type: PaymentType.RECEIPT,
      amountPoisha: dto.amountPoisha,
      method: dto.method,
      transactionRef: dto.transactionRef ?? null,
    });

    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, currency: true },
      });
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }

      if (idempotencyKey) {
        const existing = await tx.paymentEntry.findUnique({
          where: {
            type_idempotencyKey: {
              type: PaymentType.RECEIPT,
              idempotencyKey,
            },
          },
        });
        if (existing) {
          if (existing.payloadHash !== payloadHash) {
            throw new ConflictException(
              'Idempotency key already used with different payment details',
            );
          }
          return {
            entry: this.serializeEntry(existing),
            idempotentReplay: true,
          };
        }
      }

      const entry = await tx.paymentEntry.create({
        data: {
          bookingId,
          type: PaymentType.RECEIPT,
          method: dto.method,
          amountPoisha: toPoisha(dto.amountPoisha),
          currency: booking.currency,
          transactionRef: dto.transactionRef?.trim() ?? null,
          verificationState: VerificationState.PENDING,
          idempotencyKey,
          payloadHash,
          recordedById: actorId,
          reason: dto.reason ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'PaymentEntry',
          entityId: entry.id,
          action: 'PAYMENT_RECORDED_PENDING',
          details: {
            bookingId,
            method: entry.method,
            amountPoisha: toJsonPoisha(entry.amountPoisha),
            currency: entry.currency,
          },
        },
      });

      return {
        entry: this.serializeEntry(entry),
        idempotentReplay: false,
      };
    });
  }

  async verifyPayment(paymentId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.paymentEntry.findUnique({
        where: { id: paymentId },
      });
      if (!existing) {
        throw new NotFoundException('Payment entry not found');
      }
      const booking = await tx.booking.findUnique({
        where: { id: existing.bookingId },
        select: { status: true },
      });
      if (existing.verificationState === VerificationState.VERIFIED) {
        return {
          entry: this.serializeEntry(existing),
          ledger: await this.computeLedgerSummaryTx(tx, existing.bookingId),
          bookingStatus: booking?.status ?? null,
        };
      }
      if (existing.verificationState === VerificationState.REJECTED) {
        throw new ConflictException('Cannot verify a rejected payment entry');
      }

      const updated = await tx.paymentEntry.update({
        where: { id: paymentId },
        data: {
          verificationState: VerificationState.VERIFIED,
          verifiedById: actorId,
          verifiedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'PaymentEntry',
          entityId: updated.id,
          action: 'PAYMENT_VERIFIED',
          details: {
            bookingId: updated.bookingId,
            amountPoisha: toJsonPoisha(updated.amountPoisha),
          },
        },
      });

      const ledger = await this.computeLedgerSummaryTx(tx, updated.bookingId);
      return {
        entry: this.serializeEntry(updated),
        ledger,
        bookingStatus: booking?.status ?? null,
      };
    });
  }

  async rejectPayment(paymentId: string, actorId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.paymentEntry.findUnique({
        where: { id: paymentId },
      });
      if (!existing) {
        throw new NotFoundException('Payment entry not found');
      }
      if (existing.verificationState === VerificationState.VERIFIED) {
        throw new ConflictException(
          'Cannot reject an already verified payment; issue a reversal or refund instead',
        );
      }

      const updated = await tx.paymentEntry.update({
        where: { id: paymentId },
        data: {
          verificationState: VerificationState.REJECTED,
          verifiedById: actorId,
          verifiedAt: new Date(),
          reason: reason.trim(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'PaymentEntry',
          entityId: updated.id,
          action: 'PAYMENT_REJECTED',
          details: { bookingId: updated.bookingId, reason: reason.trim() },
        },
      });

      return this.serializeEntry(updated);
    });
  }

  async issueRefund(
    bookingId: string,
    actorId: string,
    dto: IssueRefundDto,
    headerIdempotencyKey?: string,
  ) {
    const idempotencyKey = dto.idempotencyKey ?? headerIdempotencyKey ?? null;
    const payloadHash = hashIdempotencyPayload({
      bookingId,
      type: PaymentType.REFUND,
      amountPoisha: dto.amountPoisha,
      method: dto.method,
      reason: dto.reason.trim(),
      relatedEntryId: dto.relatedEntryId ?? null,
    });

    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, currency: true },
      });
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }

      if (idempotencyKey) {
        const existing = await tx.paymentEntry.findUnique({
          where: {
            type_idempotencyKey: {
              type: PaymentType.REFUND,
              idempotencyKey,
            },
          },
        });
        if (existing) {
          if (existing.payloadHash !== payloadHash) {
            throw new ConflictException(
              'Idempotency key already used with different refund details',
            );
          }
          return {
            entry: this.serializeEntry(existing),
            idempotentReplay: true,
          };
        }
      }

      if (dto.relatedEntryId) {
        const related = await tx.paymentEntry.findFirst({
          where: { id: dto.relatedEntryId, bookingId },
          select: { id: true },
        });
        if (!related) {
          throw new BadRequestException('Related payment entry does not belong to this booking');
        }
      }

      const ledgerBefore = await this.computeLedgerSummaryTx(tx, bookingId);
      const netPaid =
        BigInt(ledgerBefore.verifiedReceiptsPoisha) - BigInt(ledgerBefore.completedRefundsPoisha);
      const refundAmount = toPoisha(dto.amountPoisha);
      if (refundAmount > netPaid) {
        throw new BadRequestException('Refund amount exceeds net verified receipts');
      }

      const entry = await tx.paymentEntry.create({
        data: {
          bookingId,
          type: PaymentType.REFUND,
          method: dto.method,
          amountPoisha: refundAmount,
          currency: booking.currency,
          transactionRef: dto.transactionRef?.trim() ?? null,
          verificationState: VerificationState.VERIFIED,
          idempotencyKey,
          payloadHash,
          recordedById: actorId,
          verifiedById: actorId,
          verifiedAt: new Date(),
          reason: dto.reason.trim(),
          relatedEntryId: dto.relatedEntryId ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'PaymentEntry',
          entityId: entry.id,
          action: 'REFUND_ISSUED',
          details: {
            bookingId,
            amountPoisha: toJsonPoisha(refundAmount),
            reason: dto.reason.trim(),
          },
        },
      });

      const ledgerAfter = await this.computeLedgerSummaryTx(tx, bookingId);
      return {
        entry: this.serializeEntry(entry),
        ledger: ledgerAfter,
        idempotentReplay: false,
      };
    });
  }

  async createAdjustment(
    bookingId: string,
    actorId: string,
    dto: CreateAdjustmentDto,
    headerIdempotencyKey?: string,
  ) {
    const idempotencyKey = dto.idempotencyKey ?? headerIdempotencyKey ?? null;
    const payloadHash = hashIdempotencyPayload({
      bookingId,
      type: dto.type,
      amountPoisha: dto.amountPoisha,
      reason: dto.reason.trim(),
      relatedPaymentId: dto.relatedPaymentId ?? null,
    });

    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, currency: true },
      });
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }

      if (idempotencyKey) {
        const existing = await tx.priceAdjustment.findUnique({
          where: {
            type_idempotencyKey: {
              type: dto.type,
              idempotencyKey,
            },
          },
        });
        if (existing) {
          if (existing.payloadHash !== payloadHash) {
            throw new ConflictException(
              'Idempotency key already used with different adjustment details',
            );
          }
          return {
            adjustment: {
              ...existing,
              amountPoisha: toJsonPoisha(existing.amountPoisha),
            },
            idempotentReplay: true,
          };
        }
      }

      const adjustment = await tx.priceAdjustment.create({
        data: {
          bookingId,
          type: dto.type,
          amountPoisha: toPoisha(dto.amountPoisha),
          currency: booking.currency,
          reason: dto.reason.trim(),
          status: AdjustmentStatus.APPROVED,
          actorId,
          relatedPaymentId: dto.relatedPaymentId ?? null,
          idempotencyKey,
          payloadHash,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'PriceAdjustment',
          entityId: adjustment.id,
          action: 'PRICE_ADJUSTMENT_POSTED',
          details: {
            bookingId,
            type: dto.type,
            amountPoisha: toJsonPoisha(adjustment.amountPoisha),
            reason: dto.reason.trim(),
          },
        },
      });

      const ledger = await this.computeLedgerSummaryTx(tx, bookingId);
      return {
        adjustment: {
          ...adjustment,
          amountPoisha: toJsonPoisha(adjustment.amountPoisha),
        },
        ledger,
        idempotentReplay: false,
      };
    });
  }

  async exportLedger() {
    const entries = await this.prisma.paymentEntry.findMany({
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });
    return {
      count: entries.length,
      entries: entries.map((e) => this.serializeEntry(e)),
    };
  }
}
