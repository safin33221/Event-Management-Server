import { AdvancePolicyType } from '../../../generated/prisma/client.js';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string | null;

  @IsOptional()
  @IsObject()
  themeTokens?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  contactDetails?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsEnum(AdvancePolicyType)
  advancePolicyType?: AdvancePolicyType;

  @IsOptional()
  @IsInt()
  @Min(0)
  advancePolicyValue?: number;
}
