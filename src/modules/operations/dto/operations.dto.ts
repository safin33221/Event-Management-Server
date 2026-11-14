import { AssignmentStatus, DeliverableStatus } from '../../../generated/prisma/client.js';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAssignmentDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsUUID()
  assigneeUserId!: string;

  @IsString()
  roleLabel!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateAssignmentDto {
  @IsOptional()
  @IsEnum(AssignmentStatus)
  status?: AssignmentStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateDeliverableDto {
  @IsString()
  label!: string;

  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateDeliverableDto {
  @IsOptional()
  @IsUUID()
  assigneeUserId?: string | null;

  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @IsOptional()
  @IsEnum(DeliverableStatus)
  reviewStatus?: DeliverableStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class DeliverDeliverableDto {
  @IsOptional()
  @IsString()
  deliveryUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
