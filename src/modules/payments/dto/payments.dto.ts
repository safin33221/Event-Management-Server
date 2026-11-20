import {
  AdjustmentType,
  BookingStatus,
  ExpenseCategory,
  PaymentMethod,
} from '../../../generated/prisma/client.js';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';

export class RecordPaymentDto {
  @IsInt()
  @Min(1)
  amountPoisha!: number;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsString()
  transactionRef?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class RejectPaymentDto {
  @IsString()
  reason!: string;
}

export class IssueRefundDto {
  @IsInt()
  @Min(1)
  amountPoisha!: number;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  transactionRef?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsUUID()
  relatedEntryId?: string;
}

export class CreateAdjustmentDto {
  @IsEnum(AdjustmentType)
  type!: AdjustmentType;

  @IsInt()
  @Min(1)
  amountPoisha!: number;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsUUID()
  relatedPaymentId?: string;
}

export class FinancialReportQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'from must be a valid YYYY-MM-DD date string',
  })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'to must be a valid YYYY-MM-DD date string',
  })
  to?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsEnum(BookingStatus)
  bookingStatus?: BookingStatus;
}

export class CreateExpenseDto {
  @IsEnum(ExpenseCategory)
  category!: ExpenseCategory;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  vendorOrPayee?: string;

  @IsInt()
  @Min(1)
  amountPoisha!: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'incurredOn must be a valid YYYY-MM-DD date string',
  })
  incurredOn?: string;

  @IsOptional()
  @IsUUID()
  bookingId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}


