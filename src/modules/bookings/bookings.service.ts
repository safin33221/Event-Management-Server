import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdvancePolicyType,
  BookingStatus,
  Prisma,
  ReservationStatus,
  SessionStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { getPaginationParams } from '../../common/dto/pagination.dto.js';
import { computePercentagePoisha, toJsonPoisha } from '../../common/money/money.js';
import { PaymentsService } from '../payments/payments.service.js';
import { ScheduleService } from '../schedule/schedule.service.js';
import { DEFAULT_STUDIO_ID } from '../studio/studio.service.js';
import {
  CancelBookingDto,
  ConfirmBookingDto,
  ListBookingsQueryDto,
} from './dto/bookings.dto.js';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly scheduleService: ScheduleService,
  ) {}

  private computeRequiredAdvancePoisha(
    agreedTotalPoisha: bigint,
    policyType: AdvancePolicyType,
    policyValue: bigint,
  ): bigint {
    if (policyType === AdvancePolicyType.NONE) {
      return 0n;
    }
    if (policyType === AdvancePolicyType.FIXED) {
      return policyValue > agreedTotalPoisha ? agreedTotalPoisha : policyValue;
    }
    return computePercentagePoisha(agreedTotalPoisha, policyValue);
  }

  async confirmBooking(bookingId: string, actorId: string, dto: ConfirmBookingDto) {
    return this.prisma.$transaction(async (tx) => {
      const [booking, studio] = await Promise.all([
        tx.booking.findUnique({
          where: { id: bookingId },
          include: {
            acceptedQuoteVersion: { select: { id: true, status: true } },
          },
        }),
        tx.studioSettings.findUnique({
          where: { id: DEFAULT_STUDIO_ID },
          select: { advancePolicyType: true, advancePolicyValue: true },
        }),
      ]);

      if (!booking) {
        throw new NotFoundException('Booking not found');
      }
      if (dto.expectedVersion !== undefined && booking.version !== dto.expectedVersion) {
        throw new ConflictException({
          code: 'STALE_VERSION',
          message: 'Booking was modified by another request',
        });
      }
      if (booking.status === BookingStatus.CONFIRMED) {
        throw new ConflictException('Booking is already confirmed');
      }
      if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.COMPLETED) {
        throw new ConflictException(`Cannot confirm booking in status ${booking.status}`);
      }

      const policyType =
        booking.advancePolicyTypeOverride ?? studio?.advancePolicyType ?? AdvancePolicyType.PERCENTAGE;
      const policyValue = booking.advancePolicyValueOverride ?? studio?.advancePolicyValue ?? 20n;
      const requiredAdvance = this.computeRequiredAdvancePoisha(
        booking.agreedTotalPoisha,
        policyType,
        policyValue,
      );

      const ledger = await this.paymentsService.computeLedgerSummaryTx(tx, bookingId);
      const verifiedReceipts = BigInt(ledger.verifiedReceiptsPoisha);

      if (verifiedReceipts < requiredAdvance) {
        throw new ConflictException({
          code: 'ADVANCE_REQUIREMENT_NOT_MET',
          message: `Verified receipts (${verifiedReceipts.toString()} poisha) are below required advance (${requiredAdvance.toString()} poisha)`,
          requiredAdvancePoisha: toJsonPoisha(requiredAdvance),
          verifiedReceiptsPoisha: ledger.verifiedReceiptsPoisha,
        });
      }

      const updateResult = await tx.booking.updateMany({
        where: { id: bookingId, version: booking.version },
        data: {
          status: BookingStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedById: actorId,
          version: { increment: 1 },
        },
      });
      if (updateResult.count === 0) {
        throw new ConflictException({
          code: 'STALE_VERSION',
          message: 'Booking was modified concurrently',
        });
      }

      const createdSessions = [];
      if (dto.sessions && dto.sessions.length > 0) {
        for (const s of dto.sessions) {
          const startAt = new Date(s.startAt);
          const endAt = new Date(s.endAt);
          if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
            throw new BadRequestException('Invalid session startAt / endAt');
          }
          const session = await tx.eventSession.create({
            data: {
              bookingId,
              title: s.title.trim(),
              startAt,
              endAt,
              location: s.location ?? null,
              notes: s.notes ?? null,
            },
          });
          if (s.resourceIds && s.resourceIds.length > 0) {
            await this.scheduleService.reserveResourcesTx(
              tx,
              session.id,
              s.resourceIds,
              startAt,
              endAt,
            );
          }
          await tx.scheduleAuditLog.create({
            data: {
              bookingId,
              sessionId: session.id,
              action: 'SESSION_SCHEDULED_ON_CONFIRM',
              reason: s.reason?.trim() || 'Booking confirmation',
              changedById: actorId,
              newStartAt: startAt,
              newEndAt: endAt,
            },
          });
          createdSessions.push(session);
        }
      }

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'Booking',
          entityId: bookingId,
          action: 'BOOKING_CONFIRMED',
          details: {
            requiredAdvancePoisha: toJsonPoisha(requiredAdvance),
            verifiedReceiptsPoisha: ledger.verifiedReceiptsPoisha,
          },
        },
      });

      const confirmedBooking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
      return {
        booking: {
          ...confirmedBooking,
          agreedTotalPoisha: toJsonPoisha(confirmedBooking.agreedTotalPoisha),
        },
        sessions: createdSessions,
        ledger,
      };
    });
  }

  async cancelBooking(bookingId: string, actorId: string, dto: CancelBookingDto) {
    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
      });
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }
      if (dto.expectedVersion !== undefined && booking.version !== dto.expectedVersion) {
        throw new ConflictException({
          code: 'STALE_VERSION',
          message: 'Booking was modified by another request',
        });
      }
      if (booking.status === BookingStatus.CANCELLED) {
        throw new ConflictException('Booking is already cancelled');
      }

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          version: { increment: 1 },
        },
      });

      const sessions = await tx.eventSession.findMany({
        where: { bookingId, status: SessionStatus.SCHEDULED },
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);

      if (sessionIds.length > 0) {
        await tx.eventSession.updateMany({
          where: { id: { in: sessionIds } },
          data: { status: SessionStatus.CANCELLED },
        });
        await tx.resourceReservation.updateMany({
          where: { sessionId: { in: sessionIds }, status: ReservationStatus.RESERVED },
          data: { status: ReservationStatus.RELEASED },
        });
      }

      await tx.scheduleAuditLog.create({
        data: {
          bookingId,
          action: 'BOOKING_CANCELLED',
          reason: dto.reason.trim(),
          changedById: actorId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'Booking',
          entityId: bookingId,
          action: 'BOOKING_CANCELLED',
          details: { reason: dto.reason.trim() },
        },
      });

      return {
        ...updated,
        agreedTotalPoisha: toJsonPoisha(updated.agreedTotalPoisha),
      };
    });
  }

  async completeBooking(bookingId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
      });
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }
      if (booking.status !== BookingStatus.CONFIRMED) {
        throw new ConflictException('Only confirmed bookings can be marked completed');
      }

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.COMPLETED,
          version: { increment: 1 },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'Booking',
          entityId: bookingId,
          action: 'BOOKING_COMPLETED',
        },
      });

      const ledger = await this.paymentsService.computeLedgerSummaryTx(tx, bookingId);
      return {
        booking: {
          ...updated,
          agreedTotalPoisha: toJsonPoisha(updated.agreedTotalPoisha),
        },
        ledger,
      };
    });
  }

  async listBookings(query: ListBookingsQueryDto) {
    const { page, limit, skip } = getPaginationParams(query);
    const where: Prisma.BookingWhereInput = {
      status: query.status,
      reference: query.reference ? { contains: query.reference.trim(), mode: 'insensitive' } : undefined,
      eventDate: query.eventDate ? new Date(`${query.eventDate}T00:00:00.000Z`) : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      data: items.map((b) => ({
        ...b,
        agreedTotalPoisha: toJsonPoisha(b.agreedTotalPoisha),
      })),
      meta: { page, limit, total },
    };
  }

  async getBooking(bookingId: string) {
    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: {
          sessions: {
            include: {
              reservations: { where: { status: ReservationStatus.RESERVED } },
            },
            orderBy: { startAt: 'asc' },
          },
          deliverables: { orderBy: { createdAt: 'asc' } },
          assignments: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }
      const ledger = await this.paymentsService.computeLedgerSummaryTx(tx, bookingId);
      return {
        ...booking,
        agreedTotalPoisha: toJsonPoisha(booking.agreedTotalPoisha),
        ledger,
      };
    });
  }
}
