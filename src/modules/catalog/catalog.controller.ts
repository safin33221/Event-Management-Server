import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../../common/guards/auth.guard.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { CatalogService } from './catalog.service.js';
import {
  CreateDeliverableLabelDto,
  CreateEventTypeDto,
  CreatePackageDto,
  CreatePortfolioItemDto,
  CreateServiceItemDto,
  CreateTaskTemplateDto,
  UpdatePackageDto,
  UpdatePortfolioItemDto,
} from './dto/catalog.dto.js';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('event-types')
  createEventType(@Body() dto: CreateEventTypeDto) {
    return this.catalogService.createEventType(dto);
  }

  @Get('event-types')
  listEventTypes() {
    return this.catalogService.listEventTypes();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('services')
  createServiceItem(@Body() dto: CreateServiceItemDto) {
    return this.catalogService.createServiceItem(dto);
  }

  @Get('services')
  listServiceItems() {
    return this.catalogService.listServiceItems();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('packages')
  createPackage(@Body() dto: CreatePackageDto) {
    return this.catalogService.createPackage(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Patch('packages/:id')
  updatePackage(@Param('id') id: string, @Body() dto: UpdatePackageDto) {
    return this.catalogService.updatePackage(id, dto);
  }

  @Get('packages')
  listPackages(@Query() query: PaginationQueryDto) {
    return this.catalogService.listPackages(query);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('portfolio')
  createPortfolioItem(@Body() dto: CreatePortfolioItemDto) {
    return this.catalogService.createPortfolioItem(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Patch('portfolio/:id')
  updatePortfolioItem(@Param('id') id: string, @Body() dto: UpdatePortfolioItemDto) {
    return this.catalogService.updatePortfolioItem(id, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('deliverable-labels')
  createDeliverableLabel(@Body() dto: CreateDeliverableLabelDto) {
    return this.catalogService.createDeliverableLabel(dto);
  }

  @Get('deliverable-labels')
  listDeliverableLabels() {
    return this.catalogService.listDeliverableLabels();
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Post('task-templates')
  createTaskTemplate(@Body() dto: CreateTaskTemplateDto) {
    return this.catalogService.createTaskTemplate(dto);
  }

  @Get('task-templates')
  listTaskTemplates() {
    return this.catalogService.listTaskTemplates();
  }
}
