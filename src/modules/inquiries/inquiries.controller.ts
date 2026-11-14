import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../../common/guards/auth.guard.js';
import { InquiriesService } from './inquiries.service.js';
import {
  CreateInquiryDto,
  ListInquiriesQueryDto,
  UpdateInquiryStatusDto,
} from './dto/inquiries.dto.js';

@Roles(UserRole.OWNER, UserRole.COORDINATOR)
@Controller('inquiries')
export class InquiriesController {
  constructor(private readonly inquiriesService: InquiriesService) {}

  @Post()
  create(@Body() dto: CreateInquiryDto) {
    return this.inquiriesService.createInquiry(dto, 'PHONE');
  }

  @Get()
  list(@Query() query: ListInquiriesQueryDto) {
    return this.inquiriesService.listInquiries(query);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.inquiriesService.getInquiry(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateInquiryStatusDto) {
    return this.inquiriesService.updateStatus(id, dto);
  }
}
