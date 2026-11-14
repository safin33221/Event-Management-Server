import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { CurrentActor, Roles } from '../../common/guards/auth.guard.js';
import type { RequestActor } from '../../common/guards/auth.guard.js';
import { ScheduleService } from './schedule.service.js';
import {
  CalendarQueryDto,
  CancelSessionDto,
  CreateResourceDto,
  CreateSessionDto,
  RescheduleSessionDto,
} from './dto/schedule.dto.js';

@Controller()
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('resources')
  createResource(@Body() dto: CreateResourceDto) {
    return this.scheduleService.createResource(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.STAFF)
  @Get('resources')
  listResources() {
    return this.scheduleService.listResources();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('bookings/:bookingId/sessions')
  createSession(
    @CurrentActor() actor: RequestActor,
    @Param('bookingId') bookingId: string,
    @Body() dto: CreateSessionDto,
  ) {
    return this.scheduleService.createSession(bookingId, actor.userId, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Patch('sessions/:id/reschedule')
  rescheduleSession(
    @CurrentActor() actor: RequestActor,
    @Param('id') id: string,
    @Body() dto: RescheduleSessionDto,
  ) {
    return this.scheduleService.rescheduleSession(id, actor.userId, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('sessions/:id/cancel')
  cancelSession(
    @CurrentActor() actor: RequestActor,
    @Param('id') id: string,
    @Body() dto: CancelSessionDto,
  ) {
    return this.scheduleService.cancelSession(id, actor.userId, dto.reason);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.STAFF)
  @Post('sessions/:id/complete')
  completeSession(@CurrentActor() actor: RequestActor, @Param('id') id: string) {
    return this.scheduleService.completeSession(id, actor.userId);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT, UserRole.STAFF)
  @Get('calendar')
  getCalendar(@CurrentActor() actor: RequestActor, @Query() query: CalendarQueryDto) {
    return this.scheduleService.getCalendar(actor.timezone, query);
  }
}
