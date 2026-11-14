import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeliverableStatus, UserRole } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  CreateAssignmentDto,
  CreateDeliverableDto,
  DeliverDeliverableDto,
  UpdateAssignmentDto,
  UpdateDeliverableDto,
} from './dto/operations.dto.js';

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertActiveUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true },
    });
    if (!user || !user.isActive) {
      throw new BadRequestException('Assignee is not an active team member');
    }
  }

  async createAssignment(bookingId: string, dto: CreateAssignmentDto) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (dto.sessionId) {
      const session = await this.prisma.eventSession.findFirst({
        where: { id: dto.sessionId, bookingId },
        select: { id: true },
      });
      if (!session) {
        throw new BadRequestException('Session does not belong to this booking');
      }
    }
    await this.assertActiveUser(dto.assigneeUserId);

    return this.prisma.assignment.create({
      data: {
        bookingId,
        sessionId: dto.sessionId ?? null,
        assigneeUserId: dto.assigneeUserId,
        roleLabel: dto.roleLabel.trim(),
        notes: dto.notes ?? null,
      },
    });
  }

  async listMyAssignments(userId: string) {
    return this.prisma.assignment.findMany({
      where: { assigneeUserId: userId },
      include: {
        booking: {
          select: {
            id: true,
            reference: true,
            eventTitle: true,
            eventDate: true,
            clientName: true,
            clientPhone: true,
            status: true,
          },
        },
        session: {
          select: {
            id: true,
            title: true,
            startAt: true,
            endAt: true,
            location: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateAssignment(
    assignmentId: string,
    actorUserId: string,
    actorRole: UserRole,
    dto: UpdateAssignmentDto,
  ) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    if (actorRole === UserRole.STAFF && assignment.assigneeUserId !== actorUserId) {
      throw new ForbiddenException('Staff can only update their own assignments');
    }

    return this.prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        status: dto.status,
        notes: dto.notes,
      },
    });
  }

  async createDeliverable(bookingId: string, dto: CreateDeliverableDto) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (dto.assigneeUserId) {
      await this.assertActiveUser(dto.assigneeUserId);
    }

    return this.prisma.deliverable.create({
      data: {
        bookingId,
        label: dto.label.trim(),
        assigneeUserId: dto.assigneeUserId ?? null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        notes: dto.notes ?? null,
      },
    });
  }

  async listBookingDeliverables(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    return this.prisma.deliverable.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateDeliverable(
    deliverableId: string,
    actorUserId: string,
    actorRole: UserRole,
    dto: UpdateDeliverableDto,
  ) {
    const deliverable = await this.prisma.deliverable.findUnique({
      where: { id: deliverableId },
    });
    if (!deliverable) {
      throw new NotFoundException('Deliverable not found');
    }
    if (actorRole === UserRole.STAFF && deliverable.assigneeUserId !== actorUserId) {
      throw new ForbiddenException('Staff can only update deliverables assigned to them');
    }
    if (dto.assigneeUserId) {
      await this.assertActiveUser(dto.assigneeUserId);
    }

    return this.prisma.deliverable.update({
      where: { id: deliverableId },
      data: {
        assigneeUserId: dto.assigneeUserId,
        dueAt: dto.dueAt === null ? null : dto.dueAt ? new Date(dto.dueAt) : undefined,
        reviewStatus: dto.reviewStatus,
        notes: dto.notes,
      },
    });
  }

  async deliverDeliverable(
    deliverableId: string,
    actorUserId: string,
    dto: DeliverDeliverableDto,
  ) {
    const deliverable = await this.prisma.deliverable.findUnique({
      where: { id: deliverableId },
    });
    if (!deliverable) {
      throw new NotFoundException('Deliverable not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.deliverable.update({
        where: { id: deliverableId },
        data: {
          reviewStatus: DeliverableStatus.DELIVERED,
          deliveredAt: new Date(),
          deliveryUrl: dto.deliveryUrl?.trim() ?? deliverable.deliveryUrl,
          notes: dto.notes ?? deliverable.notes,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: actorUserId,
          entityType: 'Deliverable',
          entityId: updated.id,
          action: 'DELIVERABLE_DELIVERED',
          details: {
            bookingId: updated.bookingId,
            label: updated.label,
          },
        },
      });

      return updated;
    });
  }
}
