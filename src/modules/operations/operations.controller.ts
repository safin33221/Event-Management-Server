import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { CurrentActor, Roles } from '../../common/guards/auth.guard.js';
import type { RequestActor } from '../../common/guards/auth.guard.js';
import { OperationsService } from './operations.service.js';
import {
  CreateAssignmentDto,
  CreateDeliverableDto,
  DeliverDeliverableDto,
  UpdateAssignmentDto,
  UpdateDeliverableDto,
} from './dto/operations.dto.js';

@Controller()
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('bookings/:bookingId/assignments')
  createAssignment(@Param('bookingId') bookingId: string, @Body() dto: CreateAssignmentDto) {
    return this.operationsService.createAssignment(bookingId, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.STAFF)
  @Get('assignments/my')
  listMyAssignments(@CurrentActor() actor: RequestActor) {
    return this.operationsService.listMyAssignments(actor.userId);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.STAFF)
  @Patch('assignments/:id')
  updateAssignment(
    @CurrentActor() actor: RequestActor,
    @Param('id') id: string,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.operationsService.updateAssignment(id, actor.userId, actor.role, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('bookings/:bookingId/deliverables')
  createDeliverable(@Param('bookingId') bookingId: string, @Body() dto: CreateDeliverableDto) {
    return this.operationsService.createDeliverable(bookingId, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.STAFF)
  @Get('bookings/:bookingId/deliverables')
  listDeliverables(@Param('bookingId') bookingId: string) {
    return this.operationsService.listBookingDeliverables(bookingId);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.STAFF)
  @Patch('deliverables/:id')
  updateDeliverable(
    @CurrentActor() actor: RequestActor,
    @Param('id') id: string,
    @Body() dto: UpdateDeliverableDto,
  ) {
    return this.operationsService.updateDeliverable(id, actor.userId, actor.role, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.STAFF)
  @Post('deliverables/:id/deliver')
  deliverDeliverable(
    @CurrentActor() actor: RequestActor,
    @Param('id') id: string,
    @Body() dto: DeliverDeliverableDto,
  ) {
    return this.operationsService.deliverDeliverable(id, actor.userId, dto);
  }
}
