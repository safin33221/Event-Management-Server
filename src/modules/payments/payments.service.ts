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
  BookingStatus,
  ExpenseCategory,
  ExpenseEntry,
  PaymentEntry,
  PaymentMethod,
  PaymentType,
  Prisma,
  VerificationState,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { hashIdempotencyPayload } from '../../common/crypto/hash.js';
import {
  computeRequiredAdvancePoisha,
  formatTk,
  sumPoisha,
  toJsonPoisha,
  toPoisha,
} from '../../common/money/money.js';
import {
  getUtcRangeForLocalDateRange,
  localDateStartToUtc,
  toAgencyLocalDate,
} from '../../common/time/timezone.js';
import {
  CreateAdjustmentDto,
  CreateExpenseDto,
  FinancialReportQueryDto,
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
        select: { id: true, reference: true, currency: true, status: true },
      });
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }
      if (booking.status === BookingStatus.CANCELLED) {
        throw new ConflictException(
          `Cannot record a payment on cancelled booking ${booking.reference}.`,
        );
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

      const ledger = await this.computeLedgerSummaryTx(tx, bookingId);
      const outstandingDue = BigInt(ledger.outstandingDuePoisha);
      const pendingReceipts = BigInt(ledger.pendingReceiptsPoisha);
      const paymentAmount = toPoisha(dto.amountPoisha);

      if (paymentAmount <= 0n) {
        throw new BadRequestException('Payment amount must be greater than Tk 0.');
      }
      if (outstandingDue <= 0n) {
        throw new BadRequestException(
          `Booking ${booking.reference} is already fully paid (${formatTk(ledger.effectiveAgreedChargePoisha, booking.currency)}). No additional payment can be recorded.`,
        );
      }
      if (paymentAmount > outstandingDue) {
        throw new BadRequestException(
          `Payment of ${formatTk(paymentAmount, booking.currency)} exceeds the remaining due balance of ${formatTk(outstandingDue, booking.currency)} (Total price: ${formatTk(ledger.effectiveAgreedChargePoisha, booking.currency)}, Paid: ${formatTk(ledger.verifiedReceiptsPoisha, booking.currency)}).`,
        );
      }
      if (paymentAmount + pendingReceipts > outstandingDue) {
        throw new BadRequestException(
          `Payment of ${formatTk(paymentAmount, booking.currency)} plus unverified pending payments (${formatTk(pendingReceipts, booking.currency)}) would exceed the remaining due balance of ${formatTk(outstandingDue, booking.currency)}. Please verify or reject the pending payment first.`,
        );
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
        select: { reference: true, status: true, currency: true },
      });
      if (booking?.status === BookingStatus.CANCELLED) {
        throw new ConflictException(
          `Cannot verify a payment for cancelled booking ${booking.reference}.`,
        );
      }
      if (existing.verificationState === VerificationState.VERIFIED) {
        return {
          entry: this.serializeEntry(existing),
          ledger: await this.computeLedgerSummaryTx(tx, existing.bookingId),
          bookingStatus: booking?.status ?? null,
        };
      }
      if (existing.verificationState === VerificationState.REJECTED) {
        throw new ConflictException('Cannot verify a rejected payment entry.');
      }

      const ledgerBefore = await this.computeLedgerSummaryTx(tx, existing.bookingId);
      const outstandingDue = BigInt(ledgerBefore.outstandingDuePoisha);
      if (existing.amountPoisha > outstandingDue) {
        throw new ConflictException(
          `Cannot verify payment of ${formatTk(existing.amountPoisha, existing.currency)} because it exceeds the remaining due balance of ${formatTk(outstandingDue, existing.currency)}.`,
        );
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
        throw new BadRequestException(
          `Refund of ${formatTk(refundAmount, booking.currency)} exceeds the net verified paid amount of ${formatTk(netPaid, booking.currency)}.`,
        );
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

  private serializeExpense(
    expense: ExpenseEntry & {
      booking?: {
        id: string;
        reference: string;
        eventTitle: string;
        clientName: string;
      } | null;
    },
  ) {
    return {
      ...expense,
      amountPoisha: toJsonPoisha(expense.amountPoisha),
      booking: expense.booking ?? null,
    };
  }

  async recordExpense(actorId: string, dto: CreateExpenseDto) {
    const amountPoisha = toPoisha(dto.amountPoisha);
    if (amountPoisha <= 0n) {
      throw new BadRequestException('Expense amount must be greater than Tk 0.');
    }

    const title = dto.title.trim();
    if (!title) {
      throw new BadRequestException('Expense title is required.');
    }

    return this.prisma.$transaction(async (tx) => {
      const studio = await tx.studioSettings.findUnique({
        where: { id: 'default' },
        select: { currency: true, timezone: true },
      });
      const currency = studio?.currency || 'BDT';
      const timezone = studio?.timezone || 'Asia/Dhaka';

      if (dto.bookingId) {
        const booking = await tx.booking.findUnique({
          where: { id: dto.bookingId },
          select: { id: true },
        });
        if (!booking) {
          throw new NotFoundException('Linked booking not found.');
        }
      }

      const incurredDateStr =
        dto.incurredOn || toAgencyLocalDate(new Date(), timezone);
      const incurredOn = new Date(`${incurredDateStr}T00:00:00.000Z`);

      const created = await tx.expenseEntry.create({
        data: {
          bookingId: dto.bookingId ?? null,
          category: dto.category,
          title,
          vendorOrPayee: dto.vendorOrPayee?.trim() || null,
          amountPoisha,
          currency,
          method: dto.method ?? PaymentMethod.CASH,
          reference: dto.reference?.trim() || null,
          incurredOn,
          notes: dto.notes?.trim() || null,
          recordedById: actorId,
        },
        include: {
          booking: {
            select: {
              id: true,
              reference: true,
              eventTitle: true,
              clientName: true,
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'ExpenseEntry',
          entityId: created.id,
          action: 'EXPENSE_RECORDED',
          details: {
            category: created.category,
            title: created.title,
            amountPoisha: toJsonPoisha(created.amountPoisha),
            bookingId: created.bookingId,
          },
        },
      });

      return this.serializeExpense(created);
    });
  }

  async listExpenses(query: FinancialReportQueryDto = {}) {
    if (typeof this.prisma.expenseEntry?.findMany !== 'function') {
      return [];
    }
    const where: Prisma.ExpenseEntryWhereInput = {
      ...(query.method ? { method: query.method } : {}),
      ...(query.from || query.to
        ? {
            incurredOn: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    };

    const items = await this.prisma.expenseEntry.findMany({
      where,
      include: {
        booking: {
          select: {
            id: true,
            reference: true,
            eventTitle: true,
            clientName: true,
          },
        },
      },
      orderBy: [{ incurredOn: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });

    return items.map((e) => this.serializeExpense(e));
  }

  async deleteExpense(expenseId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.expenseEntry.findUnique({
        where: { id: expenseId },
      });
      if (!existing) {
        throw new NotFoundException('Expense entry not found.');
      }

      await tx.expenseEntry.delete({
        where: { id: expenseId },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'ExpenseEntry',
          entityId: expenseId,
          action: 'EXPENSE_DELETED',
          details: {
            category: existing.category,
            title: existing.title,
            amountPoisha: toJsonPoisha(existing.amountPoisha),
            bookingId: existing.bookingId,
          },
        },
      });

      return { deletedExpenseId: expenseId };
    });
  }

  async getFinancialReport(query: FinancialReportQueryDto = {}) {
    const studio = await this.prisma.studioSettings.findUnique({
      where: { id: 'default' },
      select: {
        currency: true,
        timezone: true,
        advancePolicyType: true,
        advancePolicyValue: true,
      },
    });

    const currency = studio?.currency || 'BDT';
    const timezone = studio?.timezone || 'Asia/Dhaka';
    const defaultPolicyType = studio?.advancePolicyType ?? AdvancePolicyType.PERCENTAGE;
    const defaultPolicyValue = studio?.advancePolicyValue ?? 20n;

    let startFilter: Date | undefined;
    let endFilter: Date | undefined;
    if (query.from && query.to) {
      const range = getUtcRangeForLocalDateRange(query.from, query.to, timezone);
      startFilter = range.startUtc;
      endFilter = range.endUtcExclusive;
    } else if (query.from) {
      startFilter = localDateStartToUtc(query.from, timezone);
    } else if (query.to) {
      endFilter = getUtcRangeForLocalDateRange(query.to, query.to, timezone).endUtcExclusive;
    }

    const bookingWhere: Prisma.BookingWhereInput = {
      ...(query.bookingStatus ? { status: query.bookingStatus } : {}),
      ...(startFilter || endFilter
        ? {
            createdAt: {
              ...(startFilter ? { gte: startFilter } : {}),
              ...(endFilter ? { lt: endFilter } : {}),
            },
          }
        : {}),
    };

    const paymentWhere: Prisma.PaymentEntryWhereInput = {
      ...(query.method ? { method: query.method } : {}),
      ...(query.bookingStatus ? { booking: { status: query.bookingStatus } } : {}),
      ...(startFilter || endFilter
        ? {
            createdAt: {
              ...(startFilter ? { gte: startFilter } : {}),
              ...(endFilter ? { lt: endFilter } : {}),
            },
          }
        : {}),
    };

    const expenseWhere: Prisma.ExpenseEntryWhereInput = {
      ...(query.method ? { method: query.method } : {}),
      ...(query.bookingStatus ? { booking: { status: query.bookingStatus } } : {}),
      ...(query.from || query.to
        ? {
            incurredOn: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    };

    const [bookings, paymentEntries, expenseEntries] = await Promise.all([
      this.prisma.booking.findMany({
        where: bookingWhere,
        include: {
          eventType: { select: { id: true, name: true, slug: true } },
          paymentEntries: true,
          priceAdjustments: {
            where: { status: AdjustmentStatus.APPROVED },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.paymentEntry.findMany({
        where: paymentWhere,
        include: {
          booking: {
            select: {
              id: true,
              reference: true,
              eventTitle: true,
              clientName: true,
              clientPhone: true,
              status: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 300,
      }),
      typeof this.prisma.expenseEntry?.findMany === 'function'
        ? this.prisma.expenseEntry.findMany({
            where: expenseWhere,
            include: {
              booking: {
                select: {
                  id: true,
                  reference: true,
                  eventTitle: true,
                  clientName: true,
                },
              },
            },
            orderBy: [{ incurredOn: 'desc' }, { createdAt: 'desc' }],
            take: 300,
          })
        : Promise.resolve([]),
    ]);

    const bookingDirectExpenseMap = new Map<string, bigint>();
    for (const exp of expenseEntries) {
      if (exp.bookingId) {
        bookingDirectExpenseMap.set(
          exp.bookingId,
          (bookingDirectExpenseMap.get(exp.bookingId) ?? 0n) + exp.amountPoisha,
        );
      }
    }

    // 1. Compute per-booking financial statement & receivables
    let totalContractedPoisha = 0n;
    let totalEffectiveContractedPoisha = 0n;
    let totalCreditNotesPoisha = 0n;
    let totalChargeAdjustmentsPoisha = 0n;
    let totalOutstandingDuePoisha = 0n;
    let totalCustomerCreditPoisha = 0n;

    let activeBookingsCount = 0;
    let completedBookingsCount = 0;
    let cancelledBookingsCount = 0;
    let fullyPaidBookingsCount = 0;
    let bookingsWithDueCount = 0;

    const eventTypeAggMap = new Map<
      string,
      {
        eventTypeId: string;
        eventTypeName: string;
        bookingsCount: number;
        agreedTotalPoisha: bigint;
        collectedPoisha: bigint;
        outstandingDuePoisha: bigint;
      }
    >();

    const monthlyMap = new Map<
      string,
      {
        month: string;
        bookingsCount: number;
        contractedPoisha: bigint;
        collectedPoisha: bigint;
        refundedPoisha: bigint;
        expensesPoisha: bigint;
      }
    >();

    const ensureMonthEntry = (monthKey: string) => {
      let existing = monthlyMap.get(monthKey);
      if (!existing) {
        existing = {
          month: monthKey,
          bookingsCount: 0,
          contractedPoisha: 0n,
          collectedPoisha: 0n,
          refundedPoisha: 0n,
          expensesPoisha: 0n,
        };
        monthlyMap.set(monthKey, existing);
      }
      return existing;
    };

    const receivables = bookings.map((b) => {
      const verifiedReceipts = sumPoisha(
        b.paymentEntries
          .filter(
            (e) =>
              e.type === PaymentType.RECEIPT &&
              e.verificationState === VerificationState.VERIFIED &&
              (!query.method || e.method === query.method),
          )
          .map((e) => e.amountPoisha),
      );
      const pendingReceipts = sumPoisha(
        b.paymentEntries
          .filter(
            (e) =>
              e.type === PaymentType.RECEIPT &&
              e.verificationState === VerificationState.PENDING &&
              (!query.method || e.method === query.method),
          )
          .map((e) => e.amountPoisha),
      );
      const completedRefunds = sumPoisha(
        b.paymentEntries
          .filter(
            (e) =>
              e.type === PaymentType.REFUND &&
              e.verificationState === VerificationState.VERIFIED &&
              (!query.method || e.method === query.method),
          )
          .map((e) => e.amountPoisha),
      );
      const creditNotes = sumPoisha(
        b.priceAdjustments
          .filter((a) => a.type === AdjustmentType.CREDIT_NOTE)
          .map((a) => a.amountPoisha),
      );
      const chargeAdjustments = sumPoisha(
        b.priceAdjustments
          .filter((a) => a.type === AdjustmentType.CHARGE_ADJUSTMENT)
          .map((a) => a.amountPoisha),
      );
      const reversals = sumPoisha(
        b.priceAdjustments
          .filter((a) => a.type === AdjustmentType.REVERSAL)
          .map((a) => a.amountPoisha),
      );

      const effectiveChargeRaw =
        b.agreedTotalPoisha - creditNotes + chargeAdjustments;
      const effectiveAgreedCharge = effectiveChargeRaw > 0n ? effectiveChargeRaw : 0n;
      const netPaid = verifiedReceipts - completedRefunds - reversals;

      const isCancelled = b.status === BookingStatus.CANCELLED;
      const rawBalance = isCancelled ? 0n : effectiveAgreedCharge - netPaid;
      const outstandingDue = rawBalance > 0n ? rawBalance : 0n;
      const customerCredit =
        !isCancelled && rawBalance < 0n
          ? -rawBalance
          : isCancelled && netPaid > 0n
            ? netPaid
            : 0n;

      const policyType = b.advancePolicyTypeOverride ?? defaultPolicyType;
      const policyValue = b.advancePolicyValueOverride ?? defaultPolicyValue;
      const requiredAdvance = computeRequiredAdvancePoisha(
        effectiveAgreedCharge,
        policyType,
        policyValue,
      );

      if (isCancelled) {
        cancelledBookingsCount += 1;
      } else {
        activeBookingsCount += 1;
        if (b.status === BookingStatus.COMPLETED) {
          completedBookingsCount += 1;
        }
        totalContractedPoisha += b.agreedTotalPoisha;
        totalEffectiveContractedPoisha += effectiveAgreedCharge;
        totalCreditNotesPoisha += creditNotes;
        totalChargeAdjustmentsPoisha += chargeAdjustments;
        totalOutstandingDuePoisha += outstandingDue;
        totalCustomerCreditPoisha += customerCredit;

        if (outstandingDue === 0n) {
          fullyPaidBookingsCount += 1;
        } else {
          bookingsWithDueCount += 1;
        }

        const etId = b.eventType?.id ?? 'uncategorized';
        const etName = b.eventType?.name ?? 'General / Custom Event';
        const etBucket = eventTypeAggMap.get(etId) ?? {
          eventTypeId: etId,
          eventTypeName: etName,
          bookingsCount: 0,
          agreedTotalPoisha: 0n,
          collectedPoisha: 0n,
          outstandingDuePoisha: 0n,
        };
        etBucket.bookingsCount += 1;
        etBucket.agreedTotalPoisha += effectiveAgreedCharge;
        etBucket.collectedPoisha += netPaid > 0n ? netPaid : 0n;
        etBucket.outstandingDuePoisha += outstandingDue;
        eventTypeAggMap.set(etId, etBucket);

        const localDateStr = toAgencyLocalDate(b.createdAt, timezone);
        const monthBucket = ensureMonthEntry(localDateStr.slice(0, 7));
        monthBucket.bookingsCount += 1;
        monthBucket.contractedPoisha += effectiveAgreedCharge;
      }

      const directExpenses = bookingDirectExpenseMap.get(b.id) ?? 0n;
      const bookingNetProfit = netPaid - directExpenses;

      return {
        bookingId: b.id,
        reference: b.reference,
        eventTitle: b.eventTitle,
        eventTypeName: b.eventType?.name ?? null,
        clientName: b.clientName,
        clientPhone: b.clientPhone,
        eventDate: b.eventDate,
        status: b.status,
        createdAt: b.createdAt,
        agreedTotalPoisha: toJsonPoisha(b.agreedTotalPoisha),
        effectiveAgreedChargePoisha: toJsonPoisha(effectiveAgreedCharge),
        verifiedReceiptsPoisha: toJsonPoisha(verifiedReceipts),
        pendingReceiptsPoisha: toJsonPoisha(pendingReceipts),
        completedRefundsPoisha: toJsonPoisha(completedRefunds),
        creditNotesPoisha: toJsonPoisha(creditNotes),
        outstandingDuePoisha: toJsonPoisha(outstandingDue),
        customerCreditPoisha: toJsonPoisha(customerCredit),
        directExpensesPoisha: toJsonPoisha(directExpenses),
        bookingNetProfitPoisha: toJsonPoisha(bookingNetProfit),
        requiredAdvancePoisha: toJsonPoisha(requiredAdvance),
        isAdvanceMet: verifiedReceipts >= requiredAdvance,
      };
    });

    // 2. Aggregate payment entries by method & month
    const allMethods: PaymentMethod[] = [
      PaymentMethod.BKASH,
      PaymentMethod.NAGAD,
      PaymentMethod.BANK,
      PaymentMethod.CASH,
      PaymentMethod.OTHER,
    ];

    const methodMap = new Map<
      PaymentMethod,
      {
        method: PaymentMethod;
        verifiedReceiptsPoisha: bigint;
        pendingReceiptsPoisha: bigint;
        refundsPoisha: bigint;
        transactionCount: number;
      }
    >();
    for (const m of allMethods) {
      methodMap.set(m, {
        method: m,
        verifiedReceiptsPoisha: 0n,
        pendingReceiptsPoisha: 0n,
        refundsPoisha: 0n,
        transactionCount: 0,
      });
    }

    let totalVerifiedReceiptsPoisha = 0n;
    let totalPendingReceiptsPoisha = 0n;
    let totalCompletedRefundsPoisha = 0n;
    let pendingReceiptsCount = 0;

    for (const entry of paymentEntries) {
      const bucket = methodMap.get(entry.method)!;
      const monthKey = toAgencyLocalDate(entry.createdAt, timezone).slice(0, 7);
      const monthBucket = ensureMonthEntry(monthKey);

      if (entry.type === PaymentType.RECEIPT) {
        if (entry.verificationState === VerificationState.VERIFIED) {
          bucket.verifiedReceiptsPoisha += entry.amountPoisha;
          bucket.transactionCount += 1;
          totalVerifiedReceiptsPoisha += entry.amountPoisha;
          monthBucket.collectedPoisha += entry.amountPoisha;
        } else if (entry.verificationState === VerificationState.PENDING) {
          bucket.pendingReceiptsPoisha += entry.amountPoisha;
          bucket.transactionCount += 1;
          totalPendingReceiptsPoisha += entry.amountPoisha;
          pendingReceiptsCount += 1;
        }
      } else if (
        entry.type === PaymentType.REFUND &&
        entry.verificationState === VerificationState.VERIFIED
      ) {
        bucket.refundsPoisha += entry.amountPoisha;
        bucket.transactionCount += 1;
        totalCompletedRefundsPoisha += entry.amountPoisha;
        monthBucket.refundedPoisha += entry.amountPoisha;
      }
    }

    const netCollectedRevenuePoisha =
      totalVerifiedReceiptsPoisha - totalCompletedRefundsPoisha;

    // 3. Aggregate studio & booking expenses (kept strictly separate from customer balance)
    const allExpenseCategories: ExpenseCategory[] = [
      ExpenseCategory.CREW_PAYOUT,
      ExpenseCategory.EQUIPMENT_RENTAL,
      ExpenseCategory.ALBUM_PRINTING,
      ExpenseCategory.TRANSPORT_FOOD,
      ExpenseCategory.VENUE_DECOR,
      ExpenseCategory.STUDIO_OVERHEAD,
      ExpenseCategory.MARKETING,
      ExpenseCategory.OTHER,
    ];

    const expenseCatMap = new Map<
      ExpenseCategory,
      { category: ExpenseCategory; amountPoisha: bigint; count: number }
    >();
    for (const cat of allExpenseCategories) {
      expenseCatMap.set(cat, { category: cat, amountPoisha: 0n, count: 0 });
    }

    let totalExpensesPoisha = 0n;
    let directBookingExpensesPoisha = 0n;
    let generalOverheadExpensesPoisha = 0n;

    for (const exp of expenseEntries) {
      totalExpensesPoisha += exp.amountPoisha;
      if (exp.bookingId) {
        directBookingExpensesPoisha += exp.amountPoisha;
      } else {
        generalOverheadExpensesPoisha += exp.amountPoisha;
      }
      const catBucket = expenseCatMap.get(exp.category) ?? {
        category: exp.category,
        amountPoisha: 0n,
        count: 0,
      };
      catBucket.amountPoisha += exp.amountPoisha;
      catBucket.count += 1;
      expenseCatMap.set(exp.category, catBucket);

      const expMonthKey = exp.incurredOn.toISOString().slice(0, 7);
      const monthBucket = ensureMonthEntry(expMonthKey);
      monthBucket.expensesPoisha += exp.amountPoisha;
    }

    const netCashProfitPoisha = netCollectedRevenuePoisha - totalExpensesPoisha;
    const projectedNetProfitPoisha = totalEffectiveContractedPoisha - totalExpensesPoisha;
    const profitMarginPercent =
      netCollectedRevenuePoisha > 0n
        ? Number((netCashProfitPoisha * 1000n) / netCollectedRevenuePoisha) / 10
        : 0;

    const byExpenseCategory = Array.from(expenseCatMap.values()).map((c) => ({
      category: c.category,
      amountPoisha: toJsonPoisha(c.amountPoisha),
      count: c.count,
      sharePercent:
        totalExpensesPoisha > 0n
          ? Number((c.amountPoisha * 1000n) / totalExpensesPoisha) / 10
          : 0,
    }));

    const collectionRatePercent =
      totalEffectiveContractedPoisha > 0n
        ? Math.min(
            100,
            Math.max(
              0,
              Number((netCollectedRevenuePoisha * 1000n) / totalEffectiveContractedPoisha) / 10,
            ),
          )
        : 0;

    const byMethod = Array.from(methodMap.values()).map((b) => {
      const netMethod = b.verifiedReceiptsPoisha - b.refundsPoisha;
      const sharePercent =
        totalVerifiedReceiptsPoisha > 0n
          ? Number((b.verifiedReceiptsPoisha * 1000n) / totalVerifiedReceiptsPoisha) / 10
          : 0;
      return {
        method: b.method,
        verifiedReceiptsPoisha: toJsonPoisha(b.verifiedReceiptsPoisha),
        pendingReceiptsPoisha: toJsonPoisha(b.pendingReceiptsPoisha),
        refundsPoisha: toJsonPoisha(b.refundsPoisha),
        netCollectedPoisha: toJsonPoisha(netMethod),
        transactionCount: b.transactionCount,
        sharePercent,
      };
    });

    const byMonth = Array.from(monthlyMap.values())
      .sort((a, b) => b.month.localeCompare(a.month))
      .map((m) => {
        const netCol = m.collectedPoisha - m.refundedPoisha;
        return {
          month: m.month,
          bookingsCount: m.bookingsCount,
          contractedPoisha: toJsonPoisha(m.contractedPoisha),
          collectedPoisha: toJsonPoisha(m.collectedPoisha),
          refundedPoisha: toJsonPoisha(m.refundedPoisha),
          netCollectedPoisha: toJsonPoisha(netCol),
          expensesPoisha: toJsonPoisha(m.expensesPoisha),
          netCashProfitPoisha: toJsonPoisha(netCol - m.expensesPoisha),
        };
      });

    const byEventType = Array.from(eventTypeAggMap.values())
      .sort((a, b) => Number(b.agreedTotalPoisha - a.agreedTotalPoisha))
      .map((et) => ({
        eventTypeId: et.eventTypeId,
        eventTypeName: et.eventTypeName,
        bookingsCount: et.bookingsCount,
        agreedTotalPoisha: toJsonPoisha(et.agreedTotalPoisha),
        collectedPoisha: toJsonPoisha(et.collectedPoisha),
        outstandingDuePoisha: toJsonPoisha(et.outstandingDuePoisha),
      }));

    const transactions = paymentEntries.slice(0, 100).map((e) => ({
      ...this.serializeEntry(e),
      booking: e.booking,
    }));

    const expenses = expenseEntries.slice(0, 150).map((e) => this.serializeExpense(e));

    return {
      currency,
      timezone,
      generatedAt: new Date().toISOString(),
      filters: {
        from: query.from ?? null,
        to: query.to ?? null,
        method: query.method ?? null,
        bookingStatus: query.bookingStatus ?? null,
      },
      summary: {
        totalContractedPoisha: toJsonPoisha(totalContractedPoisha),
        effectiveContractedPoisha: toJsonPoisha(totalEffectiveContractedPoisha),
        verifiedReceiptsPoisha: toJsonPoisha(totalVerifiedReceiptsPoisha),
        pendingVerificationPoisha: toJsonPoisha(totalPendingReceiptsPoisha),
        completedRefundsPoisha: toJsonPoisha(totalCompletedRefundsPoisha),
        netCollectedRevenuePoisha: toJsonPoisha(netCollectedRevenuePoisha),
        totalCreditNotesPoisha: toJsonPoisha(totalCreditNotesPoisha),
        totalChargeAdjustmentsPoisha: toJsonPoisha(totalChargeAdjustmentsPoisha),
        totalOutstandingDuePoisha: toJsonPoisha(totalOutstandingDuePoisha),
        totalCustomerCreditPoisha: toJsonPoisha(totalCustomerCreditPoisha),
        totalExpensesPoisha: toJsonPoisha(totalExpensesPoisha),
        directBookingExpensesPoisha: toJsonPoisha(directBookingExpensesPoisha),
        generalOverheadExpensesPoisha: toJsonPoisha(generalOverheadExpensesPoisha),
        netCashProfitPoisha: toJsonPoisha(netCashProfitPoisha),
        projectedNetProfitPoisha: toJsonPoisha(projectedNetProfitPoisha),
        profitMarginPercent,
        expensesCount: expenseEntries.length,
        collectionRatePercent,
        activeBookingsCount,
        completedBookingsCount,
        cancelledBookingsCount,
        fullyPaidBookingsCount,
        bookingsWithDueCount,
        pendingReceiptsCount,
      },
      byMethod,
      byExpenseCategory,
      byMonth,
      byEventType,
      receivables,
      transactions,
      expenses,
    };
  }
}
