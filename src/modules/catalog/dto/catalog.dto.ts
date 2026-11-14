import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateEventTypeDto {
  @IsString()
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateServiceItemDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  unitLabel?: string;

  @IsInt()
  @Min(0)
  defaultUnitPricePoisha!: number;
}

export class PackageItemInputDto {
  @IsOptional()
  @IsUUID()
  serviceItemId?: string;

  @IsString()
  description!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsInt()
  @Min(0)
  unitPricePoisha!: number;
}

export class CreatePackageDto {
  @IsOptional()
  @IsUUID()
  eventTypeId?: string;

  @IsString()
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(0)
  basePricePoisha!: number;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageItemInputDto)
  items?: PackageItemInputDto[];
}

export class UpdatePackageDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  basePricePoisha?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageItemInputDto)
  items?: PackageItemInputDto[];
}

export class CreatePortfolioItemDto {
  @IsOptional()
  @IsUUID()
  eventTypeId?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  mediaUrl!: string;

  @IsOptional()
  @IsBoolean()
  isApproved?: boolean;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdatePortfolioItemDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isApproved?: boolean;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateDeliverableLabelDto {
  @IsOptional()
  @IsUUID()
  eventTypeId?: string;

  @IsString()
  label!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultDueDays?: number;
}

export class UpdateDeliverableLabelDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultDueDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateTaskTemplateDto {
  @IsOptional()
  @IsUUID()
  eventTypeId?: string;

  @IsString()
  title!: string;

  @IsString()
  roleLabel!: string;

  @IsOptional()
  @IsInt()
  defaultOffsetDays?: number;
}

export class UpdateTaskTemplateDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  roleLabel?: string;

  @IsOptional()
  @IsInt()
  defaultOffsetDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
