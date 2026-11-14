import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { ScheduleModule } from '../schedule/schedule.module.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';

@Module({
  imports: [PaymentsModule, ScheduleModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
