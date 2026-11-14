import { InquiryStatus } from '../../../generated/prisma/client.js';
import {
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

export class CreateInquiryDto {
  @IsOptional()
  @IsUUID()
  eventTypeId?: string;

  @IsOptional()
  @IsUUID()
  packageId?: string;

  @IsString()
  eventTitle!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'requestedDate must be YYYY-MM-DD' })
  requestedDate?: string;

  @IsString()
  clientName!: string;

  @IsString()
  clientPhone!: string;

  @IsOptional()
  @IsEmail()
  clientEmail?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ListInquiriesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(InquiryStatus)
  status?: InquiryStatus;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  requestedDate?: string;
}

export class UpdateInquiryStatusDto {
  @IsEnum(InquiryStatus)
  status!: InquiryStatus;
}
