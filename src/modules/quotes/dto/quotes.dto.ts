import { AcceptanceChannel, QuoteStatus } from '../../../generated/prisma/client.js';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

export class QuoteLineItemInputDto {
  @IsOptional()
  @IsUUID()
  packageId?: string;

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

export class CreateQuoteDto {
  @IsOptional()
  @IsUUID()
  inquiryId?: string;

  @IsOptional()
  @IsUUID()
  eventTypeId?: string;

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

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineItemInputDto)
  items!: QuoteLineItemInputDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  discountPoisha?: number;

  @IsOptional()
  @IsString()
  terms?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  validUntil?: string;
}

export class CreateQuoteVersionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineItemInputDto)
  items!: QuoteLineItemInputDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  discountPoisha?: number;

  @IsOptional()
  @IsString()
  terms?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  validUntil?: string;
}

export class AcceptQuoteDto {
  @IsOptional()
  @IsUUID()
  versionId?: string;

  @IsString()
  acceptedBy!: string;

  @IsEnum(AcceptanceChannel)
  acceptedChannel!: AcceptanceChannel;
}

export class ListQuotesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(QuoteStatus)
  status?: QuoteStatus;

  @IsOptional()
  @IsString()
  reference?: string;
}
