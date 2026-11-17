import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
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

  @Get(':id/invoice.pdf')
  async getQuotePdf(
    @Param('id') id: string,
    @Query('disposition') disposition: string | undefined,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<StreamableFile> {
    const { filename, buffer } = await this.quotesService.getQuoteInvoicePdf(id);
    const safeDisposition = disposition === 'inline' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${safeDisposition}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(buffer);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.quotesService.getQuote(id);
  }
}
