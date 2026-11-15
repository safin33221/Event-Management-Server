import { ResourceType } from '../../../generated/prisma/client.js';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class CreateResourceDto {
  @IsString()
  name!: string;

  @IsEnum(ResourceType)
  type!: ResourceType;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class CreateSessionDto {
  @IsString()
  title!: string;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  resourceIds?: string[];

  @IsOptional()
  @IsString()
  reason?: string;
}

export class RescheduleSessionDto {
  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  resourceIds?: string[];
}

export class CancelSessionDto {
  @IsString()
  reason!: string;
}

export class CalendarQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to!: string;
}

export class ResourceAvailabilityQueryDto {
  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @IsOptional()
  @IsUUID()
  excludeSessionId?: string;
}
