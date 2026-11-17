import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { UserRole } from '../../generated/prisma/client.js';
import { CurrentActor, Public, Roles } from '../../common/guards/auth.guard.js';
import type { RequestActor } from '../../common/guards/auth.guard.js';
import { ScheduleService } from './schedule.service.js';
import {
  CalendarQueryDto,
  CancelSessionDto,
  CreateResourceDto,
  CreateSessionDto,
  RescheduleSessionDto,
  ResourceAvailabilityQueryDto,
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

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.STAFF)
  @Get('resources/availability')
  checkAvailability(@Query() query: ResourceAvailabilityQueryDto) {
    return this.scheduleService.checkResourceAvailability(query);
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
  @Get('sessions/:id/calendar.ics')
  async downloadSessionIcs(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<StreamableFile> {
    const { filename, ics } = await this.scheduleService.getSessionIcs(id);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(Buffer.from(ics, 'utf8'));
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT, UserRole.STAFF)
  @Get('calendar')
  getCalendar(@CurrentActor() actor: RequestActor, @Query() query: CalendarQueryDto) {
    return this.scheduleService.getCalendar(actor.timezone, query);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT, UserRole.STAFF)
  @Get('calendar/subscription')
  getCalendarSubscription() {
    return this.scheduleService.getSubscriptionInfo();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('calendar/subscription/rotate')
  rotateCalendarSubscription() {
    return this.scheduleService.rotateSubscriptionToken();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT, UserRole.STAFF)
  @Get('calendar.ics')
  async downloadStudioCalendarIcs(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<StreamableFile> {
    const validDate = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    const { filename, ics } = await this.scheduleService.getStudioCalendarIcs(
      validDate(from),
      validDate(to),
      true,
    );
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(Buffer.from(ics, 'utf8'));
  }

  @Public()
  @Get('public/calendar/feed.ics')
  async publicCalendarFeed(
    @Query('token') token: string | undefined,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<StreamableFile> {
    const { ics } = await this.scheduleService.getPublicFeedIcs(token);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="studio-schedule.ics"');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(Buffer.from(ics, 'utf8'));
  }
}
