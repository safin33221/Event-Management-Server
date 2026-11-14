import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma, ReservationStatus, SessionStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  getUtcRangeForLocalDateRange,
  toAgencyLocalDate,
} from '../../common/time/timezone.js';
import {
  CalendarQueryDto,
  CreateResourceDto,
  CreateSessionDto,
  RescheduleSessionDto,
} from './dto/schedule.dto.js';

@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async createResource(dto: CreateResourceDto) {
    if (dto.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: dto.userId },
        select: { id: true, isActive: true },
      });
      if (!user || !user.isActive) {
        throw new BadRequestException('User is not an active team member');
      }
    }

    return this.prisma.resource.create({
      data: {
        name: dto.name.trim(),
        type: dto.type,
        userId: dto.userId ?? null,
      },
    });
  }

  async listResources() {
    return this.prisma.resource.findMany({
      where: { isActive: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Atomically locks the requested resources in deterministic order and checks
   * half-open [startAt, endAt) overlap before inserting RESERVED rows.
   * PostgreSQL GIST exclusion constraint also enforces this at the storage layer.
   */
  async reserveResourcesTx(
    tx: Prisma.TransactionClient,
    sessionId: string,
    resourceIds: string[],
    startAt: Date,
    endAt: Date,
  ): Promise<void> {
    if (endAt <= startAt) {
      throw new BadRequestException('Session endAt must be strictly after startAt');
    }
    const uniqueIds = [...new Set(resourceIds)].sort();
    if (uniqueIds.length === 0) {
      return;
    }

    const resources = await tx.resource.findMany({
      where: { id: { in: uniqueIds }, isActive: true },
      select: { id: true },
    });
    if (resources.length !== uniqueIds.length) {
      throw new BadRequestException('One or more resources do not exist or are inactive');
    }

    // Lock the resource rows in deterministic order to serialize concurrent reservations
    await tx.$queryRaw`
      SELECT id FROM resources
      WHERE id = ANY(${uniqueIds}::uuid[])
      ORDER BY id ASC
      FOR UPDATE
    `;

    // Half-open interval [startAt, endAt) overlap check: existing.start < new.end AND existing.end > new.start
    const conflicts = await tx.resourceReservation.findMany({
      where: {
        resourceId: { in: uniqueIds },
        status: ReservationStatus.RESERVED,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { resourceId: true, sessionId: true, startAt: true, endAt: true },
    });

    if (conflicts.length > 0) {
      throw new ConflictException({
        code: 'RESOURCE_UNAVAILABLE',
        message: 'One or more resources are already reserved for an overlapping time slot',
        conflicts,
      });
    }

    await tx.resourceReservation.createMany({
      data: uniqueIds.map((resourceId) => ({
        sessionId,
        resourceId,
        startAt,
        endAt,
        status: ReservationStatus.RESERVED,
      })),
    });
  }

  async createSession(bookingId: string, actorId: string, dto: CreateSessionDto) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new BadRequestException('Invalid startAt / endAt interval');
    }

    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, status: true },
      });
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }
      if (booking.status === BookingStatus.CANCELLED) {
        throw new ConflictException('Cannot schedule sessions on a cancelled booking');
      }

      const session = await tx.eventSession.create({
        data: {
          bookingId,
          title: dto.title.trim(),
          startAt,
          endAt,
          location: dto.location ?? null,
          notes: dto.notes ?? null,
        },
      });

      if (dto.resourceIds && dto.resourceIds.length > 0) {
        await this.reserveResourcesTx(tx, session.id, dto.resourceIds, startAt, endAt);
      }

      await tx.scheduleAuditLog.create({
        data: {
          bookingId,
          sessionId: session.id,
          action: 'SESSION_SCHEDULED',
          reason: dto.reason?.trim() || 'Initial session scheduling',
          changedById: actorId,
          newStartAt: startAt,
          newEndAt: endAt,
        },
      });

      return tx.eventSession.findUnique({
        where: { id: session.id },
        include: { reservations: { where: { status: ReservationStatus.RESERVED } } },
      });
    });
  }

  async rescheduleSession(sessionId: string, actorId: string, dto: RescheduleSessionDto) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new BadRequestException('Invalid startAt / endAt interval');
    }

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.eventSession.findUnique({
        where: { id: sessionId },
        include: {
          reservations: { where: { status: ReservationStatus.RESERVED } },
        },
      });
      if (!session) {
        throw new NotFoundException('Session not found');
      }
      if (session.status === SessionStatus.CANCELLED) {
        throw new ConflictException('Cannot reschedule a cancelled session');
      }

      const targetResourceIds =
        dto.resourceIds ?? session.reservations.map((r) => r.resourceId);

      await tx.resourceReservation.updateMany({
        where: { sessionId, status: ReservationStatus.RESERVED },
        data: { status: ReservationStatus.RELEASED },
      });

      const updated = await tx.eventSession.update({
        where: { id: sessionId },
        data: { startAt, endAt },
      });

      if (targetResourceIds.length > 0) {
        await this.reserveResourcesTx(tx, sessionId, targetResourceIds, startAt, endAt);
      }

      await tx.scheduleAuditLog.create({
        data: {
          bookingId: session.bookingId,
          sessionId,
          action: 'SESSION_RESCHEDULED',
          reason: dto.reason.trim(),
          changedById: actorId,
          previousStartAt: session.startAt,
          previousEndAt: session.endAt,
          newStartAt: startAt,
          newEndAt: endAt,
        },
      });

      return tx.eventSession.findUnique({
        where: { id: updated.id },
        include: { reservations: { where: { status: ReservationStatus.RESERVED } } },
      });
    });
  }

  async cancelSession(sessionId: string, actorId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.eventSession.findUnique({
        where: { id: sessionId },
      });
      if (!session) {
        throw new NotFoundException('Session not found');
      }

      const updated = await tx.eventSession.update({
        where: { id: sessionId },
        data: { status: SessionStatus.CANCELLED },
      });

      await tx.resourceReservation.updateMany({
        where: { sessionId, status: ReservationStatus.RESERVED },
        data: { status: ReservationStatus.RELEASED },
      });

      await tx.scheduleAuditLog.create({
        data: {
          bookingId: session.bookingId,
          sessionId,
          action: 'SESSION_CANCELLED',
          reason: reason.trim(),
          changedById: actorId,
          previousStartAt: session.startAt,
          previousEndAt: session.endAt,
        },
      });

      return updated;
    });
  }

  async completeSession(sessionId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.eventSession.findUnique({
        where: { id: sessionId },
      });
      if (!session) {
        throw new NotFoundException('Session not found');
      }
      if (session.status === SessionStatus.CANCELLED) {
        throw new ConflictException('Cannot complete a cancelled session');
      }

      const updated = await tx.eventSession.update({
        where: { id: sessionId },
        data: { status: SessionStatus.COMPLETED },
      });

      await tx.scheduleAuditLog.create({
        data: {
          bookingId: session.bookingId,
          sessionId,
          action: 'SESSION_COMPLETED',
          reason: 'Session marked completed',
          changedById: actorId,
        },
      });

      return updated;
    });
  }

  async getCalendar(studioTimezone: string, query: CalendarQueryDto) {
    const { startUtc, endUtcExclusive } = getUtcRangeForLocalDateRange(
      query.from,
      query.to,
      studioTimezone,
    );

    const sessions = await this.prisma.eventSession.findMany({
      where: {
        status: { not: SessionStatus.CANCELLED },
        startAt: { lt: endUtcExclusive },
        endAt: { gt: startUtc },
      },
      include: {
        booking: {
          select: { id: true, reference: true, eventTitle: true, clientName: true, status: true },
        },
        reservations: {
          where: { status: ReservationStatus.RESERVED },
          include: {
            resource: { select: { id: true, name: true, type: true } },
          },
        },
      },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });

    return {
      timezone: studioTimezone,
      from: query.from,
      to: query.to,
      sessions: sessions.map((s) => ({
        ...s,
        agencyLocalDate: toAgencyLocalDate(s.startAt, studioTimezone),
      })),
    };
  }
}
