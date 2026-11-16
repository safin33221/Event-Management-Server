import { Transform } from 'class-transformer';
import { InquiryStatus } from '../../../generated/prisma/client.js';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateInquiryDto {
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  eventTypeId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  packageId?: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'Event title is required' })
  eventTitle!: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'requestedDate must be YYYY-MM-DD' })
  requestedDate?: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'Client name is required' })
  clientName!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'Client phone is required' })
  clientPhone!: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEmail()
  clientEmail?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
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
