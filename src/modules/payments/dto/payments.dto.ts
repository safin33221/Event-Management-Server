import { AdjustmentType, PaymentMethod } from '../../../generated/prisma/client.js';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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
