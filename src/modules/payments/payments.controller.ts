import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { CurrentActor, Roles } from '../../common/guards/auth.guard.js';
import type { RequestActor } from '../../common/guards/auth.guard.js';
import { PaymentsService } from './payments.service.js';
import {
  CreateAdjustmentDto,
  CreateExpenseDto,
  FinancialReportQueryDto,
  IssueRefundDto,
  RecordPaymentDto,
  RejectPaymentDto,
} from './dto/payments.dto.js';

@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT)
  @Get('bookings/:bookingId/ledger')
  getBookingLedger(@Param('bookingId') bookingId: string) {
    return this.paymentsService.getBookingLedger(bookingId);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT)
  @Post('bookings/:bookingId/payments')
  recordPayment(
    @CurrentActor() actor: RequestActor,
    @Param('bookingId') bookingId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.paymentsService.recordPayment(bookingId, actor.userId, dto, idempotencyKey);
  }

  @Roles(UserRole.OWNER, UserRole.ACCOUNTANT)
  @Post('payments/:id/verify')
  verifyPayment(@CurrentActor() actor: RequestActor, @Param('id') id: string) {
    return this.paymentsService.verifyPayment(id, actor.userId);
  }

  @Roles(UserRole.OWNER, UserRole.ACCOUNTANT)
  @Post('payments/:id/reject')
  rejectPayment(
    @CurrentActor() actor: RequestActor,
    @Param('id') id: string,
    @Body() dto: RejectPaymentDto,
  ) {
    return this.paymentsService.rejectPayment(id, actor.userId, dto.reason);
  }

  @Roles(UserRole.OWNER, UserRole.ACCOUNTANT)
  @Post('bookings/:bookingId/refunds')
  issueRefund(
    @CurrentActor() actor: RequestActor,
    @Param('bookingId') bookingId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: IssueRefundDto,
  ) {
    return this.paymentsService.issueRefund(bookingId, actor.userId, dto, idempotencyKey);
  }

  @Roles(UserRole.OWNER, UserRole.ACCOUNTANT)
  @Post('bookings/:bookingId/adjustments')
  createAdjustment(
    @CurrentActor() actor: RequestActor,
    @Param('bookingId') bookingId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateAdjustmentDto,
  ) {
    return this.paymentsService.createAdjustment(bookingId, actor.userId, dto, idempotencyKey);
  }

  @Roles(UserRole.OWNER, UserRole.ACCOUNTANT)
  @Get('finance/export')
  exportLedger() {
    return this.paymentsService.exportLedger();
  }

  @Roles(UserRole.OWNER, UserRole.ACCOUNTANT)
  @Get('finance/report')
  getFinancialReport(@Query() query: FinancialReportQueryDto) {
    return this.paymentsService.getFinancialReport(query);
  }

  @Roles(UserRole.OWNER, UserRole.ACCOUNTANT)
  @Post('finance/expenses')
  recordExpense(
    @CurrentActor() actor: RequestActor,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.paymentsService.recordExpense(actor.userId, dto);
  }

  @Roles(UserRole.OWNER, UserRole.ACCOUNTANT)
  @Get('finance/expenses')
  listExpenses(@Query() query: FinancialReportQueryDto) {
    return this.paymentsService.listExpenses(query);
  }

  @Roles(UserRole.OWNER, UserRole.ACCOUNTANT)
  @Delete('finance/expenses/:id')
  deleteExpense(
    @CurrentActor() actor: RequestActor,
    @Param('id') id: string,
  ) {
    return this.paymentsService.deleteExpense(id, actor.userId);
  }
}
