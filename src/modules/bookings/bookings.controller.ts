import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { UserRole } from '../../generated/prisma/client.js';
import { CurrentActor, Roles } from '../../common/guards/auth.guard.js';
import type { RequestActor } from '../../common/guards/auth.guard.js';
import { BookingsService } from './bookings.service.js';
import {
  CancelBookingDto,
  ConfirmBookingDto,
  ListBookingsQueryDto,
} from './dto/bookings.dto.js';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT)
  @Get()
  list(@Query() query: ListBookingsQueryDto) {
    return this.bookingsService.listBookings(query);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT)
  @Get('automation-alerts')
  getAutomationAlerts() {
    return this.bookingsService.getAutomationAlerts();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT)
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.bookingsService.getBooking(id);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT)
  @Get(':id/receipt')
  getReceipt(@Param('id') id: string) {
    return this.bookingsService.getBookingReceipt(id);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT)
  @Get(':id/invoice.pdf')
  async getInvoicePdf(
    @Param('id') id: string,
    @Query('disposition') disposition: string | undefined,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<StreamableFile> {
    const { filename, buffer } = await this.bookingsService.getBookingInvoicePdf(id);
    const safeDisposition = disposition === 'inline' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${safeDisposition}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(buffer);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post(':id/confirm')
  confirm(
    @CurrentActor() actor: RequestActor,
    @Param('id') id: string,
    @Body() dto: ConfirmBookingDto,
  ) {
    return this.bookingsService.confirmBooking(id, actor.userId, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post(':id/complete')
  complete(@CurrentActor() actor: RequestActor, @Param('id') id: string) {
    return this.bookingsService.completeBooking(id, actor.userId);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post(':id/cancel')
  cancel(
    @CurrentActor() actor: RequestActor,
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
  ) {
    return this.bookingsService.cancelBooking(id, actor.userId, dto);
  }
}
