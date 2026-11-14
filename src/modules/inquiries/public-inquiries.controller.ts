import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../../common/guards/auth.guard.js';
import { CreateInquiryDto } from './dto/inquiries.dto.js';
import { InquiriesService } from './inquiries.service.js';

@Public()
@Controller('public/inquiries')
export class PublicInquiriesController {
  constructor(private readonly inquiriesService: InquiriesService) {}

  @Post()
  async submitPublicInquiry(@Body() dto: CreateInquiryDto) {
    const created = await this.inquiriesService.createInquiry(dto, 'PUBLIC');
    return {
      reference: created.reference,
      status: created.status,
      requestedDate: created.requestedDate,
    };
  }
}
