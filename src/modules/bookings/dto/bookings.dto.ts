import { BookingStatus } from '../../../generated/prisma/client.js';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { CreateSessionDto } from '../../schedule/dto/schedule.dto.js';

export class ConfirmBookingDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSessionDto)
  sessions?: CreateSessionDto[];
}

export class CancelBookingDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;

  @IsString()
  reason!: string;
}

export class ListBookingsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  eventDate?: string;
}
