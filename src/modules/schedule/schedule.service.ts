import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
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
  ResourceAvailabilityQueryDto,
  UpdateResourceDto,
} from './dto/schedule.dto.js';
import {
  buildIcsCalendar,
  signCalendarFeedToken,
  verifyCalendarFeedToken,
} from './ical.js';

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
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, isActive: true },
        },
      },
    });
  }

  async listResources() {
    return this.prisma.resource.findMany({
      where: { isActive: true },
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, isActive: true },
        },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  async updateResource(id: string, dto: UpdateResourceDto) {
    const existing = await this.prisma.resource.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Resource not found');
    }

    if (dto.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: dto.userId },
        select: { id: true, isActive: true },
      });
      if (!user || !user.isActive) {
        throw new BadRequestException('Linked team member does not exist or is inactive');
      }
    }

    return this.prisma.resource.update({
      where: { id },
      data: {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        type: dto.type,
        userId: dto.userId === null ? null : dto.userId,
        isActive: dto.isActive,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, isActive: true },
        },
      },
    });
  }

  async deactivateResource(id: string) {
    const existing = await this.prisma.resource.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Resource not found');
    }

    const activeFutureReservation = await this.prisma.resourceReservation.findFirst({
      where: {
        resourceId: id,
        status: ReservationStatus.RESERVED,
        endAt: { gt: new Date() },
        session: { status: SessionStatus.SCHEDULED },
      },
      include: {
        session: {
          select: {
            title: true,
            booking: { select: { reference: true } },
          },
        },
      },
    });

    if (activeFutureReservation) {
      const ref = activeFutureReservation.session.booking?.reference ?? '';
      throw new ConflictException(
        `Cannot remove "${existing.name}" because it is reserved for upcoming session "${activeFutureReservation.session.title}"${ref ? ` (${ref})` : ''}. Update that shoot session first.`,
      );
    }

    await this.prisma.resource.update({
      where: { id },
      data: { isActive: false },
    });

    return { archived: true, id };
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
        select: { id: true, reference: true, status: true },
      });
      if (!booking) {
        throw new NotFoundException('Booking not found');
      }
      if (booking.status === BookingStatus.CANCELLED) {
        throw new ConflictException(`Cannot schedule sessions on cancelled booking ${booking.reference}.`);
      }
      if (booking.status === BookingStatus.COMPLETED) {
        throw new ConflictException(`Cannot schedule new sessions on completed booking ${booking.reference}.`);
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
          booking: { select: { id: true, reference: true, status: true } },
          reservations: { where: { status: ReservationStatus.RESERVED } },
        },
      });
      if (!session) {
        throw new NotFoundException('Session not found');
      }
      if (session.status === SessionStatus.CANCELLED) {
        throw new ConflictException('Cannot reschedule a cancelled session.');
      }
      if (session.status === SessionStatus.COMPLETED) {
        throw new ConflictException('Cannot reschedule a session that is already completed.');
      }
      if (session.booking.status === BookingStatus.CANCELLED || session.booking.status === BookingStatus.COMPLETED) {
        throw new ConflictException(
          `Cannot reschedule sessions for booking ${session.booking.reference} because it is already ${session.booking.status.toLowerCase()}.`,
        );
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
        include: { booking: { select: { reference: true, status: true } } },
      });
      if (!session) {
        throw new NotFoundException('Session not found');
      }
      if (session.status === SessionStatus.CANCELLED) {
        throw new ConflictException('Session is already cancelled.');
      }
      if (session.booking.status === BookingStatus.COMPLETED) {
        throw new ConflictException(
          `Cannot cancel a session on completed booking ${session.booking.reference}.`,
        );
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
            resource: { select: { id: true, name: true, type: true, userId: true } },
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

  async checkResourceAvailability(query: ResourceAvailabilityQueryDto) {
    const startAt = new Date(query.startAt);
    const endAt = new Date(query.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new BadRequestException('Invalid startAt / endAt interval');
    }

    const [resources, conflicts] = await Promise.all([
      this.prisma.resource.findMany({
        where: { isActive: true },
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true, isActive: true },
          },
        },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.resourceReservation.findMany({
        where: {
          status: ReservationStatus.RESERVED,
          startAt: { lt: endAt },
          endAt: { gt: startAt },
          sessionId: query.excludeSessionId ? { not: query.excludeSessionId } : undefined,
          session: { status: { not: SessionStatus.CANCELLED } },
        },
        include: {
          session: {
            select: {
              id: true,
              title: true,
              startAt: true,
              endAt: true,
              booking: { select: { reference: true, eventTitle: true } },
            },
          },
        },
        orderBy: { startAt: 'asc' },
      }),
    ]);

    const conflictByResource = new Map<string, (typeof conflicts)[number]>();
    for (const row of conflicts) {
      if (!conflictByResource.has(row.resourceId)) {
        conflictByResource.set(row.resourceId, row);
      }
    }

    return {
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      resources: resources.map((resource) => {
        const hit = conflictByResource.get(resource.id);
        return {
          ...resource,
          available: !hit,
          conflict: hit
            ? {
                sessionId: hit.session.id,
                title: hit.session.title,
                startAt: hit.session.startAt,
                endAt: hit.session.endAt,
                bookingReference: hit.session.booking?.reference ?? null,
                eventTitle: hit.session.booking?.eventTitle ?? null,
              }
            : null,
        };
      }),
    };
  }

  async getSessionIcs(sessionId: string): Promise<{ filename: string; ics: string }> {
    const [session, studio] = await Promise.all([
      this.prisma.eventSession.findUnique({
        where: { id: sessionId },
        include: {
          booking: {
            select: { reference: true, eventTitle: true, clientName: true },
          },
          reservations: {
            where: { status: ReservationStatus.RESERVED },
            include: { resource: { select: { name: true } } },
          },
        },
      }),
      this.prisma.studioSettings.findUnique({
        where: { id: 'default' },
        select: { name: true, timezone: true },
      }),
    ]);

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const studioName = studio?.name || 'Softilo Event Management';
    const timezone = studio?.timezone || 'Asia/Dhaka';
    const crewNames = session.reservations.map((r) => r.resource.name).join(', ');
    const summaryPrefix = session.booking ? `[${session.booking.reference}] ` : '';
    const descLines = [
      session.booking ? `Booking: ${session.booking.reference} - ${session.booking.eventTitle}` : null,
      session.booking ? `Client: ${session.booking.clientName}` : null,
      crewNames ? `Crew & Gear: ${crewNames}` : null,
      session.notes ? `Notes: ${session.notes}` : null,
    ].filter((line): line is string => Boolean(line));

    const ics = buildIcsCalendar({
      calendarName: studioName,
      timezone,
      events: [
        {
          id: session.id,
          title: `${summaryPrefix}${session.title}`,
          startAt: session.startAt,
          endAt: session.endAt,
          location: session.location,
          description: descLines.join('\n'),
          status: session.status,
        },
      ],
    });

    const safeSlug = (session.booking?.reference || session.id).replace(/[^a-zA-Z0-9_-]/g, '-');
    return { filename: `session-${safeSlug}.ics`, ics };
  }

  async getStudioCalendarIcs(
    from?: string,
    to?: string,
    includeClientDetails = true,
  ): Promise<{ filename: string; ics: string }> {
    const studio = await this.prisma.studioSettings.findUnique({
      where: { id: 'default' },
      select: { name: true, timezone: true },
    });
    const studioName = studio?.name || 'Softilo Event Management';
    const timezone = studio?.timezone || 'Asia/Dhaka';

    let startUtc: Date;
    let endUtcExclusive: Date;
    if (from && to) {
      const range = getUtcRangeForLocalDateRange(from, to, timezone);
      startUtc = range.startUtc;
      endUtcExclusive = range.endUtcExclusive;
    } else {
      const now = Date.now();
      startUtc = new Date(now - 30 * 86_400_000);
      endUtcExclusive = new Date(now + 365 * 86_400_000);
    }

    const sessions = await this.prisma.eventSession.findMany({
      where: {
        status: { not: SessionStatus.CANCELLED },
        startAt: { lt: endUtcExclusive },
        endAt: { gt: startUtc },
      },
      include: {
        booking: {
          select: { reference: true, eventTitle: true, clientName: true },
        },
        reservations: {
          where: { status: ReservationStatus.RESERVED },
          include: { resource: { select: { name: true } } },
        },
      },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });

    const ics = buildIcsCalendar({
      calendarName: `${studioName} Schedule`,
      timezone,
      events: sessions.map((session) => {
        const crewNames = session.reservations.map((r) => r.resource.name).join(', ');
        const summaryPrefix = session.booking ? `[${session.booking.reference}] ` : '';
        const descLines = [
          session.booking ? `Booking: ${session.booking.reference} - ${session.booking.eventTitle}` : null,
          includeClientDetails && session.booking ? `Client: ${session.booking.clientName}` : null,
          crewNames ? `Crew & Gear: ${crewNames}` : null,
          includeClientDetails && session.notes ? `Notes: ${session.notes}` : null,
        ].filter((line): line is string => Boolean(line));

        return {
          id: session.id,
          title: `${summaryPrefix}${session.title}`,
          startAt: session.startAt,
          endAt: session.endAt,
          location: session.location,
          description: descLines.join('\n'),
          status: session.status,
        };
      }),
    });

    return { filename: 'studio-schedule.ics', ics };
  }

  private extractCalendarFeedKey(policies: Prisma.JsonValue | null | undefined): string | null {
    if (!policies || typeof policies !== 'object' || Array.isArray(policies)) {
      return null;
    }
    const raw = (policies as Record<string, unknown>).calendarFeedKey;
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
  }

  async getSubscriptionInfo() {
    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 16) {
      throw new BadRequestException('AUTH_SECRET must be configured for calendar subscriptions');
    }
    const studio = await this.prisma.studioSettings.findUnique({
      where: { id: 'default' },
      select: { name: true, timezone: true, operationalPolicies: true },
    });
    const feedKey = this.extractCalendarFeedKey(studio?.operationalPolicies);
    const token = signCalendarFeedToken(secret, feedKey);
    return {
      studioName: studio?.name || 'Softilo Event Management',
      timezone: studio?.timezone || 'Asia/Dhaka',
      feedPath: `/public/calendar/feed.ics?token=${encodeURIComponent(token)}`,
    };
  }

  async rotateSubscriptionToken() {
    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 16) {
      throw new BadRequestException('AUTH_SECRET must be configured for calendar subscriptions');
    }
    const studio = await this.prisma.studioSettings.findUnique({
      where: { id: 'default' },
      select: { name: true, timezone: true, operationalPolicies: true },
    });
    const existingPolicies =
      studio?.operationalPolicies &&
      typeof studio.operationalPolicies === 'object' &&
      !Array.isArray(studio.operationalPolicies)
        ? (studio.operationalPolicies as Record<string, unknown>)
        : {};
    const nextFeedKey = randomBytes(16).toString('hex');
    const updated = await this.prisma.studioSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        operationalPolicies: { ...existingPolicies, calendarFeedKey: nextFeedKey } as Prisma.InputJsonValue,
      },
      update: {
        operationalPolicies: { ...existingPolicies, calendarFeedKey: nextFeedKey } as Prisma.InputJsonValue,
      },
      select: { name: true, timezone: true },
    });
    const token = signCalendarFeedToken(secret, nextFeedKey);
    return {
      studioName: updated.name || 'Softilo Event Management',
      timezone: updated.timezone || 'Asia/Dhaka',
      feedPath: `/public/calendar/feed.ics?token=${encodeURIComponent(token)}`,
    };
  }

  async getPublicFeedIcs(token: string | undefined) {
    const secret = process.env.AUTH_SECRET ?? '';
    const studio = await this.prisma.studioSettings.findUnique({
      where: { id: 'default' },
      select: { operationalPolicies: true },
    });
    const feedKey = this.extractCalendarFeedKey(studio?.operationalPolicies);
    if (!verifyCalendarFeedToken(token, secret, feedKey)) {
      throw new UnauthorizedException('Invalid or expired calendar subscription token');
    }
    // Publicly subscribable feed omits client phone/email/notes for privacy
    return this.getStudioCalendarIcs(undefined, undefined, false);
  }
}
