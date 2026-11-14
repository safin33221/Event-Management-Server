import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdjustmentStatus,
  AdvancePolicyType,
  AssignmentStatus,
  BookingStatus,
  DeliverableStatus,
  PaymentType,
  Prisma,
  ReservationStatus,
  SessionStatus,
  UserRole,
  VerificationState,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { getPaginationParams } from '../../common/dto/pagination.dto.js';
import { computeRequiredAdvancePoisha, toJsonPoisha } from '../../common/money/money.js';
import { toAgencyLocalDate } from '../../common/time/timezone.js';
import { PaymentsService } from '../payments/payments.service.js';
import { ScheduleService } from '../schedule/schedule.service.js';
import { buildBookingInvoicePdf } from './invoice-pdf.js';
import { DEFAULT_STUDIO_ID, StudioService } from '../studio/studio.service.js';
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
    private readonly studioService: StudioService,
  ) {}

  private addDaysUtc(baseDate: Date, days: number): Date {
    return new Date(baseDate.getTime() + days * 86_400_000);
  }

  private async autoProvisionOperationsTx(
    tx: Prisma.TransactionClient,
    params: {
      bookingId: string;
      eventTypeId: string | null;
      eventDate: Date | null;
      actorId: string;
      createdSessionIds: string[];
      studioTimezone: string;
      autoProvisionDeliverables?: boolean;
      autoProvisionTasks?: boolean;
    },
  ) {
    const baseDate = params.eventDate ?? new Date();
    const createdDeliverables = [];
    const createdAssignments = [];

    if (params.autoProvisionDeliverables !== false) {
      const [labelTemplates, existingDeliverables] = await Promise.all([
        tx.deliverableLabel.findMany({
          where: {
            isActive: true,
            eventTypeId: params.eventTypeId ?? null,
          },
          orderBy: { defaultDueDays: 'asc' },
        }),
        tx.deliverable.findMany({
          where: { bookingId: params.bookingId },
          select: { label: true },
        }),
      ]);

      const existingLabels = new Set(
        existingDeliverables.map((d) => d.label.trim().toLowerCase()),
      );

      for (const tpl of labelTemplates) {
        if (existingLabels.has(tpl.label.trim().toLowerCase())) {
          continue;
        }
        const created = await tx.deliverable.create({
          data: {
            bookingId: params.bookingId,
            label: tpl.label.trim(),
            dueAt: this.addDaysUtc(baseDate, tpl.defaultDueDays),
            notes: `Auto-created from template (+${tpl.defaultDueDays}d)`,
          },
        });
        createdDeliverables.push(created);
      }
    }

    if (params.autoProvisionTasks !== false) {
      const existingAssignmentCount = await tx.assignment.count({
        where: { bookingId: params.bookingId },
      });

      if (existingAssignmentCount === 0) {
        const taskTemplates = await tx.taskTemplate.findMany({
          where: {
            isActive: true,
            eventTypeId: params.eventTypeId ?? null,
          },
          orderBy: { defaultOffsetDays: 'asc' },
        });

        if (taskTemplates.length > 0) {
          const [activeUsers, sessionCrew] = await Promise.all([
            tx.user.findMany({
              where: { isActive: true },
              select: { id: true, role: true },
              orderBy: { createdAt: 'asc' },
            }),
            params.createdSessionIds.length > 0
              ? tx.resourceReservation.findMany({
                  where: {
                    sessionId: { in: params.createdSessionIds },
                    status: ReservationStatus.RESERVED,
                    resource: { userId: { not: null } },
                  },
                  include: {
                    resource: { select: { userId: true } },
                  },
                })
              : Promise.resolve([]),
          ]);

          const activeUserIds = new Set(activeUsers.map((u) => u.id));
          const staffUser = activeUsers.find((u) => u.role === UserRole.STAFF);
          const coordinatorUser = activeUsers.find((u) => u.role === UserRole.COORDINATOR);
          const primaryCrewReservation = sessionCrew.find(
            (r) => r.resource.userId && activeUserIds.has(r.resource.userId),
          );

          for (const tpl of taskTemplates) {
            const roleLower = tpl.roleLabel.toLowerCase();
            let assigneeUserId = params.actorId;
            let sessionId: string | null = null;

            if (tpl.defaultOffsetDays === 0 && primaryCrewReservation?.resource.userId) {
              assigneeUserId = primaryCrewReservation.resource.userId;
              sessionId = primaryCrewReservation.sessionId;
            } else if (roleLower.includes('coordinator') && coordinatorUser) {
              assigneeUserId = coordinatorUser.id;
            } else if (
              (roleLower.includes('photo') ||
                roleLower.includes('cinema') ||
                roleLower.includes('editor')) &&
              staffUser
            ) {
              assigneeUserId = staffUser.id;
            }

            if (!activeUserIds.has(assigneeUserId)) {
              assigneeUserId = params.actorId;
            }

            const targetDate = toAgencyLocalDate(
              this.addDaysUtc(baseDate, tpl.defaultOffsetDays),
              params.studioTimezone,
            );
            const offsetSign = tpl.defaultOffsetDays >= 0 ? '+' : '';
            const created = await tx.assignment.create({
              data: {
                bookingId: params.bookingId,
                sessionId,
                assigneeUserId,
                roleLabel: `${tpl.title} (${tpl.roleLabel})`,
                notes: `Auto-scheduled target: ${targetDate} (${offsetSign}${tpl.defaultOffsetDays}d)`,
              },
            });
            createdAssignments.push(created);
          }
        }
      }
    }

    return { createdDeliverables, createdAssignments };
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
          select: {
            advancePolicyType: true,
            advancePolicyValue: true,
            timezone: true,
          },
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
      const requiredAdvance = computeRequiredAdvancePoisha(
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

      const studioTimezone = studio?.timezone || 'Asia/Dhaka';
      const { createdDeliverables, createdAssignments } =
        await this.autoProvisionOperationsTx(tx, {
          bookingId,
          eventTypeId: booking.eventTypeId,
          eventDate: booking.eventDate ?? createdSessions[0]?.startAt ?? null,
          actorId,
          createdSessionIds: createdSessions.map((s) => s.id),
          studioTimezone,
          autoProvisionDeliverables: dto.autoProvisionDeliverables,
          autoProvisionTasks: dto.autoProvisionTasks,
        });

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'Booking',
          entityId: bookingId,
          action: 'BOOKING_CONFIRMED',
          details: {
            requiredAdvancePoisha: toJsonPoisha(requiredAdvance),
            verifiedReceiptsPoisha: ledger.verifiedReceiptsPoisha,
            autoProvisionedDeliverables: createdDeliverables.length,
            autoProvisionedAssignments: createdAssignments.length,
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
        deliverables: createdDeliverables,
        assignments: createdAssignments,
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
        include: {
          eventType: { select: { id: true, name: true, slug: true } },
        },
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
        advancePolicyValueOverride:
          b.advancePolicyValueOverride !== null
            ? toJsonPoisha(b.advancePolicyValueOverride)
            : null,
      })),
      meta: { page, limit, total },
    };
  }

  async getBooking(bookingId: string) {
    return this.prisma.$transaction(async (tx) => {
      const [booking, studio, scheduleAuditLogs] = await Promise.all([
        tx.booking.findUnique({
          where: { id: bookingId },
          include: {
            eventType: { select: { id: true, name: true, slug: true } },
            quote: { select: { id: true, reference: true } },
            acceptedQuoteVersion: {
              include: {
                items: { orderBy: { sortOrder: 'asc' } },
              },
            },
            sessions: {
              include: {
                reservations: {
                  where: { status: ReservationStatus.RESERVED },
                  include: {
                    resource: { select: { id: true, name: true, type: true } },
                  },
                },
              },
              orderBy: { startAt: 'asc' },
            },
            deliverables: { orderBy: { createdAt: 'asc' } },
            assignments: {
              include: {
                assignee: { select: { id: true, name: true, email: true, role: true } },
                session: { select: { id: true, title: true } },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        }),
        tx.studioSettings.findUnique({
          where: { id: DEFAULT_STUDIO_ID },
          select: { timezone: true },
        }),
        tx.scheduleAuditLog.findMany({
          where: { bookingId },
          orderBy: { createdAt: 'desc' },
          take: 15,
        }),
      ]);
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }
      const studioTimezone = studio?.timezone || 'Asia/Dhaka';
      const ledger = await this.paymentsService.computeLedgerSummaryTx(tx, bookingId);

      const assigneeIds = [
        ...new Set(
          booking.deliverables
            .map((d) => d.assigneeUserId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const assigneeUsers =
        assigneeIds.length > 0
          ? await tx.user.findMany({
              where: { id: { in: assigneeIds } },
              select: { id: true, name: true },
            })
          : [];
      const userNameMap = new Map(assigneeUsers.map((u) => [u.id, u.name]));

      return {
        ...booking,
        agreedTotalPoisha: toJsonPoisha(booking.agreedTotalPoisha),
        advancePolicyValueOverride:
          booking.advancePolicyValueOverride !== null
            ? toJsonPoisha(booking.advancePolicyValueOverride)
            : null,
        acceptedQuoteVersion: booking.acceptedQuoteVersion
          ? {
              ...booking.acceptedQuoteVersion,
              subtotalPoisha: toJsonPoisha(booking.acceptedQuoteVersion.subtotalPoisha),
              discountPoisha: toJsonPoisha(booking.acceptedQuoteVersion.discountPoisha),
              totalPoisha: toJsonPoisha(booking.acceptedQuoteVersion.totalPoisha),
              items: booking.acceptedQuoteVersion.items.map((item) => ({
                ...item,
                unitPricePoisha: toJsonPoisha(item.unitPricePoisha),
                lineTotalPoisha: toJsonPoisha(item.lineTotalPoisha),
              })),
            }
          : undefined,
        sessions: booking.sessions.map((s) => ({
          ...s,
          agencyLocalDate: toAgencyLocalDate(s.startAt, studioTimezone),
        })),
        deliverables: booking.deliverables.map((d) => ({
          ...d,
          assigneeName: d.assigneeUserId ? (userNameMap.get(d.assigneeUserId) ?? null) : null,
        })),
        scheduleAuditLogs,
        ledger,
      };
    });
  }

  async getAutomationAlerts() {
    const now = new Date();
    const dueSoonCutoff = this.addDaysUtc(now, 5);

    const [
      studio,
      pendingPayments,
      pendingBookings,
      confirmedBookings,
      urgentDeliverables,
    ] = await Promise.all([
      this.prisma.studioSettings.findUnique({
        where: { id: DEFAULT_STUDIO_ID },
        select: {
          advancePolicyType: true,
          advancePolicyValue: true,
          timezone: true,
          currency: true,
        },
      }),
      this.prisma.paymentEntry.findMany({
        where: {
          type: PaymentType.RECEIPT,
          verificationState: VerificationState.PENDING,
        },
        include: {
          booking: {
            select: { id: true, reference: true, eventTitle: true, clientName: true, status: true },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 25,
      }),
      this.prisma.booking.findMany({
        where: { status: BookingStatus.PENDING_CONFIRMATION },
        include: {
          paymentEntries: {
            where: {
              type: PaymentType.RECEIPT,
              verificationState: VerificationState.VERIFIED,
            },
            select: { amountPoisha: true },
          },
        },
        orderBy: { eventDate: 'asc' },
        take: 50,
      }),
      this.prisma.booking.findMany({
        where: { status: BookingStatus.CONFIRMED },
        include: {
          sessions: {
            where: { status: { in: [SessionStatus.SCHEDULED, SessionStatus.COMPLETED] } },
            select: { id: true },
          },
          assignments: {
            where: { status: { not: AssignmentStatus.CANCELLED } },
            select: { id: true },
          },
        },
        orderBy: { eventDate: 'asc' },
        take: 50,
      }),
      this.prisma.deliverable.findMany({
        where: {
          reviewStatus: { not: DeliverableStatus.DELIVERED },
          dueAt: { lte: dueSoonCutoff },
        },
        include: {
          booking: {
            select: { id: true, reference: true, eventTitle: true, clientName: true, status: true },
          },
        },
        orderBy: { dueAt: 'asc' },
        take: 25,
      }),
    ]);

    const readyToConfirmBookings: Array<{
      id: string;
      reference: string;
      eventTitle: string;
      clientName: string;
      eventDate: Date | null;
      agreedTotalPoisha: number;
      verifiedReceiptsPoisha: number;
      requiredAdvancePoisha: number;
    }> = [];
    const awaitingAdvanceBookings: typeof readyToConfirmBookings = [];

    for (const b of pendingBookings) {
      const policyType =
        b.advancePolicyTypeOverride ?? studio?.advancePolicyType ?? AdvancePolicyType.PERCENTAGE;
      const policyValue = b.advancePolicyValueOverride ?? studio?.advancePolicyValue ?? 20n;
      const required = computeRequiredAdvancePoisha(b.agreedTotalPoisha, policyType, policyValue);
      const verified = b.paymentEntries.reduce((sum, p) => sum + p.amountPoisha, 0n);

      const item = {
        id: b.id,
        reference: b.reference,
        eventTitle: b.eventTitle,
        clientName: b.clientName,
        eventDate: b.eventDate,
        agreedTotalPoisha: toJsonPoisha(b.agreedTotalPoisha),
        verifiedReceiptsPoisha: toJsonPoisha(verified),
        requiredAdvancePoisha: toJsonPoisha(required),
      };

      if (verified >= required) {
        readyToConfirmBookings.push(item);
      } else {
        awaitingAdvanceBookings.push(item);
      }
    }

    const unscheduledConfirmedBookings = confirmedBookings
      .filter((b) => b.sessions.length === 0)
      .map((b) => ({
        id: b.id,
        reference: b.reference,
        eventTitle: b.eventTitle,
        clientName: b.clientName,
        eventDate: b.eventDate,
      }));

    const unassignedConfirmedBookings = confirmedBookings
      .filter((b) => b.assignments.length === 0)
      .map((b) => ({
        id: b.id,
        reference: b.reference,
        eventTitle: b.eventTitle,
        clientName: b.clientName,
        eventDate: b.eventDate,
      }));

    const serializedPendingPayments = pendingPayments.map((p) => ({
      id: p.id,
      bookingId: p.bookingId,
      method: p.method,
      amountPoisha: toJsonPoisha(p.amountPoisha),
      currency: p.currency,
      transactionRef: p.transactionRef,
      createdAt: p.createdAt,
      booking: p.booking,
    }));

    const activeDeliverables = urgentDeliverables
      .filter((d) => d.booking.status !== BookingStatus.CANCELLED)
      .map((d) => ({
        id: d.id,
        bookingId: d.bookingId,
        label: d.label,
        dueAt: d.dueAt,
        reviewStatus: d.reviewStatus,
        isOverdue: Boolean(d.dueAt && d.dueAt < now),
        booking: {
          id: d.booking.id,
          reference: d.booking.reference,
          eventTitle: d.booking.eventTitle,
          clientName: d.booking.clientName,
        },
      }));

    return {
      currency: studio?.currency || 'BDT',
      timezone: studio?.timezone || 'Asia/Dhaka',
      pendingPayments: serializedPendingPayments,
      readyToConfirmBookings,
      awaitingAdvanceBookings,
      unscheduledConfirmedBookings,
      unassignedConfirmedBookings,
      urgentDeliverables: activeDeliverables,
      counts: {
        pendingPayments: serializedPendingPayments.length,
        readyToConfirm: readyToConfirmBookings.length,
        awaitingAdvance: awaitingAdvanceBookings.length,
        unscheduledConfirmed: unscheduledConfirmedBookings.length,
        unassignedConfirmed: unassignedConfirmedBookings.length,
        urgentDeliverables: activeDeliverables.length,
      },
    };
  }

  async getBookingReceipt(bookingId: string) {
    const [studio, receiptData] = await Promise.all([
      this.studioService.getPublicBranding(),
      this.prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
          include: {
            eventType: { select: { id: true, name: true } },
            quote: { select: { id: true, reference: true } },
            acceptedQuoteVersion: {
              include: { items: { orderBy: { sortOrder: 'asc' } } },
            },
            paymentEntries: {
              where: { verificationState: VerificationState.VERIFIED },
              orderBy: { createdAt: 'asc' },
            },
            priceAdjustments: {
              where: { status: AdjustmentStatus.APPROVED },
              orderBy: { createdAt: 'asc' },
            },
          },
        });
        if (!booking) {
          throw new NotFoundException('Booking not found');
        }
        const ledger = await this.paymentsService.computeLedgerSummaryTx(tx, bookingId);
        return { booking, ledger };
      }),
    ]);

    const { booking, ledger } = receiptData;
    return {
      studio,
      booking: {
        id: booking.id,
        reference: booking.reference,
        status: booking.status,
        eventTitle: booking.eventTitle,
        eventTypeName: booking.eventType?.name ?? null,
        eventDate: booking.eventDate,
        clientName: booking.clientName,
        clientPhone: booking.clientPhone,
        clientEmail: booking.clientEmail,
        currency: booking.currency,
        agreedTotalPoisha: toJsonPoisha(booking.agreedTotalPoisha),
        confirmedAt: booking.confirmedAt,
        createdAt: booking.createdAt,
      },
      quote: {
        reference: booking.quote.reference,
        versionNumber: booking.acceptedQuoteVersion.versionNumber,
        acceptedAt: booking.acceptedQuoteVersion.acceptedAt,
        acceptedBy: booking.acceptedQuoteVersion.acceptedBy,
        acceptedChannel: booking.acceptedQuoteVersion.acceptedChannel,
        terms: booking.acceptedQuoteVersion.terms,
        subtotalPoisha: toJsonPoisha(booking.acceptedQuoteVersion.subtotalPoisha),
        discountPoisha: toJsonPoisha(booking.acceptedQuoteVersion.discountPoisha),
        totalPoisha: toJsonPoisha(booking.acceptedQuoteVersion.totalPoisha),
        items: booking.acceptedQuoteVersion.items.map((item) => ({
          id: item.id,
          description: item.description,
          quantity: item.quantity,
          unitPricePoisha: toJsonPoisha(item.unitPricePoisha),
          lineTotalPoisha: toJsonPoisha(item.lineTotalPoisha),
        })),
      },
      ledger,
      payments: booking.paymentEntries.map((p) => ({
        id: p.id,
        type: p.type,
        method: p.method,
        amountPoisha: toJsonPoisha(p.amountPoisha),
        currency: p.currency,
        transactionRef: p.transactionRef,
        verifiedAt: p.verifiedAt,
        reason: p.reason,
        createdAt: p.createdAt,
      })),
      adjustments: booking.priceAdjustments.map((a) => ({
        id: a.id,
        type: a.type,
        amountPoisha: toJsonPoisha(a.amountPoisha),
        reason: a.reason,
        createdAt: a.createdAt,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  async getBookingInvoicePdf(bookingId: string): Promise<{ filename: string; buffer: Buffer }> {
    const receipt = await this.getBookingReceipt(bookingId);
    const buffer = await buildBookingInvoicePdf(receipt);
    const safeReference = receipt.booking.reference.replace(/[^a-zA-Z0-9_-]/g, '-');
    return {
      filename: `invoice-${safeReference}.pdf`,
      buffer,
    };
  }
}
