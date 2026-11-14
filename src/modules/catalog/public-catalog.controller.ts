import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../common/guards/auth.guard.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { CatalogService } from './catalog.service.js';

@Public()
@Controller('public')
export class PublicCatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('event-types')
  listPublicEventTypes() {
    return this.catalogService.listEventTypes();
  }

  @Get('packages')
  listPublicPackages(@Query() query: PaginationQueryDto) {
    return this.catalogService.listPublicPackages(query);
  }

  @Get('portfolio')
  listPublicPortfolio(@Query() query: PaginationQueryDto) {
    return this.catalogService.listPublicPortfolio(query);
  }
}
