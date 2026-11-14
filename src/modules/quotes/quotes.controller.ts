import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { CurrentActor, Roles } from '../../common/guards/auth.guard.js';
import type { RequestActor } from '../../common/guards/auth.guard.js';
import { QuotesService } from './quotes.service.js';
import {
  AcceptQuoteDto,
  CreateQuoteDto,
  CreateQuoteVersionDto,
  ListQuotesQueryDto,
} from './dto/quotes.dto.js';

@Roles(UserRole.OWNER, UserRole.COORDINATOR)
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post()
  create(@CurrentActor() actor: RequestActor, @Body() dto: CreateQuoteDto) {
    return this.quotesService.createQuote(actor.currency, dto);
  }

  @Post(':id/versions')
  createVersion(@Param('id') id: string, @Body() dto: CreateQuoteVersionDto) {
    return this.quotesService.createVersion(id, dto);
  }

  @Post(':id/send')
  send(@Param('id') id: string) {
    return this.quotesService.sendQuote(id);
  }

  @Post(':id/accept')
  accept(
    @CurrentActor() actor: RequestActor,
    @Param('id') id: string,
    @Body() dto: AcceptQuoteDto,
  ) {
    return this.quotesService.acceptQuote(id, actor.userId, dto);
  }

  @Get()
  list(@Query() query: ListQuotesQueryDto) {
    return this.quotesService.listQuotes(query);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.quotesService.getQuote(id);
  }
}
