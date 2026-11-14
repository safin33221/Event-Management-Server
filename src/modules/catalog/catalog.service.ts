import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { toJsonPoisha, toPoisha } from '../../common/money/money.js';
import { PaginationQueryDto, getPaginationParams } from '../../common/dto/pagination.dto.js';
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

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertEventTypeExists(eventTypeId?: string) {
    if (!eventTypeId) return;
    const found = await this.prisma.eventType.findUnique({
      where: { id: eventTypeId },
      select: { id: true },
    });
    if (!found) {
      throw new BadRequestException('EventType not found');
    }
  }

  private async assertServiceItemsExist(serviceItemIds: string[]) {
    if (serviceItemIds.length === 0) return;
    const uniqueIds = [...new Set(serviceItemIds)];
    const count = await this.prisma.serviceItem.count({
      where: { id: { in: uniqueIds } },
    });
    if (count !== uniqueIds.length) {
      throw new BadRequestException('One or more service items do not exist');
    }
  }

  private serializePackage(pkg: {
    id: string;
    eventTypeId: string | null;
    name: string;
    slug: string;
    description: string | null;
    basePricePoisha: bigint;
    isActive: boolean;
    isPublished: boolean;
    items?: Array<{
      id: string;
      serviceItemId: string | null;
      description: string;
      quantity: number;
      unitPricePoisha: bigint;
    }>;
  }) {
    return {
      id: pkg.id,
      eventTypeId: pkg.eventTypeId,
      name: pkg.name,
      slug: pkg.slug,
      description: pkg.description,
      basePricePoisha: toJsonPoisha(pkg.basePricePoisha),
      isActive: pkg.isActive,
      isPublished: pkg.isPublished,
      items: pkg.items?.map((item) => ({
        id: item.id,
        serviceItemId: item.serviceItemId,
        description: item.description,
        quantity: item.quantity,
        unitPricePoisha: toJsonPoisha(item.unitPricePoisha),
      })),
    };
  }

  async createEventType(dto: CreateEventTypeDto) {
    return this.prisma.eventType.create({
      data: {
        name: dto.name.trim(),
        slug: dto.slug.trim().toLowerCase(),
        description: dto.description,
      },
    });
  }

  async listEventTypes() {
    return this.prisma.eventType.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async createServiceItem(dto: CreateServiceItemDto) {
    const created = await this.prisma.serviceItem.create({
      data: {
        name: dto.name.trim(),
        description: dto.description,
        unitLabel: dto.unitLabel?.trim() || 'unit',
        defaultUnitPricePoisha: toPoisha(dto.defaultUnitPricePoisha),
      },
    });
    return {
      ...created,
      defaultUnitPricePoisha: toJsonPoisha(created.defaultUnitPricePoisha),
    };
  }

  async listServiceItems() {
    const items = await this.prisma.serviceItem.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return items.map((i) => ({
      ...i,
      defaultUnitPricePoisha: toJsonPoisha(i.defaultUnitPricePoisha),
    }));
  }

  async createPackage(dto: CreatePackageDto) {
    await this.assertEventTypeExists(dto.eventTypeId);
    const serviceIds = (dto.items ?? [])
      .map((i) => i.serviceItemId)
      .filter((id): id is string => Boolean(id));
    await this.assertServiceItemsExist(serviceIds);

    const created = await this.prisma.package.create({
      data: {
        eventTypeId: dto.eventTypeId ?? null,
        name: dto.name.trim(),
        slug: dto.slug.trim().toLowerCase(),
        description: dto.description,
        basePricePoisha: toPoisha(dto.basePricePoisha),
        isPublished: dto.isPublished ?? false,
        items: dto.items
          ? {
              create: dto.items.map((item) => ({
                serviceItemId: item.serviceItemId ?? null,
                description: item.description.trim(),
                quantity: item.quantity,
                unitPricePoisha: toPoisha(item.unitPricePoisha),
              })),
            }
          : undefined,
      },
      include: { items: true },
    });
    return this.serializePackage(created);
  }

  async updatePackage(packageId: string, dto: UpdatePackageDto) {
    const existing = await this.prisma.package.findUnique({
      where: { id: packageId },
    });
    if (!existing) {
      throw new NotFoundException('Package not found');
    }

    if (dto.items) {
      const serviceIds = dto.items
        .map((i) => i.serviceItemId)
        .filter((id): id is string => Boolean(id));
      await this.assertServiceItemsExist(serviceIds);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.packageItem.deleteMany({
          where: { packageId },
        });
      }

      return tx.package.update({
        where: { id: packageId },
        data: {
          name: dto.name?.trim(),
          description: dto.description,
          basePricePoisha:
            dto.basePricePoisha !== undefined ? toPoisha(dto.basePricePoisha) : undefined,
          isActive: dto.isActive,
          isPublished: dto.isPublished,
          items: dto.items
            ? {
                create: dto.items.map((item) => ({
                  serviceItemId: item.serviceItemId ?? null,
                  description: item.description.trim(),
                  quantity: item.quantity,
                  unitPricePoisha: toPoisha(item.unitPricePoisha),
                })),
              }
            : undefined,
        },
        include: { items: true },
      });
    });

    return this.serializePackage(updated);
  }

  async listPackages(query: PaginationQueryDto) {
    const { page, limit, skip } = getPaginationParams(query);
    const [items, total] = await Promise.all([
      this.prisma.package.findMany({
        include: { items: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.package.count(),
    ]);

    return {
      data: items.map((p) => this.serializePackage(p)),
      meta: { page, limit, total },
    };
  }

  async listPublicPackages(query: PaginationQueryDto) {
    const { page, limit, skip } = getPaginationParams(query);
    const where = { isActive: true, isPublished: true };
    const [items, total] = await Promise.all([
      this.prisma.package.findMany({
        where,
        include: { items: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.package.count({ where }),
    ]);

    return {
      data: items.map((p) => this.serializePackage(p)),
      meta: { page, limit, total },
    };
  }

  async createPortfolioItem(dto: CreatePortfolioItemDto) {
    await this.assertEventTypeExists(dto.eventTypeId);
    return this.prisma.portfolioItem.create({
      data: {
        eventTypeId: dto.eventTypeId ?? null,
        title: dto.title.trim(),
        description: dto.description,
        mediaUrl: dto.mediaUrl.trim(),
        isApproved: dto.isApproved ?? false,
        isPublished: dto.isPublished ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updatePortfolioItem(itemId: string, dto: UpdatePortfolioItemDto) {
    const existing = await this.prisma.portfolioItem.findUnique({
      where: { id: itemId },
    });
    if (!existing) {
      throw new NotFoundException('Portfolio item not found');
    }
    return this.prisma.portfolioItem.update({
      where: { id: itemId },
      data: {
        title: dto.title?.trim(),
        description: dto.description,
        isApproved: dto.isApproved,
        isPublished: dto.isPublished,
        sortOrder: dto.sortOrder,
      },
    });
  }

  async listPublicPortfolio(query: PaginationQueryDto) {
    const { page, limit, skip } = getPaginationParams(query);
    const where = { isApproved: true, isPublished: true };
    const [items, total] = await Promise.all([
      this.prisma.portfolioItem.findMany({
        where,
        select: {
          id: true,
          eventTypeId: true,
          title: true,
          description: true,
          mediaUrl: true,
          sortOrder: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.portfolioItem.count({ where }),
    ]);
    return { data: items, meta: { page, limit, total } };
  }

  async createDeliverableLabel(dto: CreateDeliverableLabelDto) {
    await this.assertEventTypeExists(dto.eventTypeId);
    return this.prisma.deliverableLabel.create({
      data: {
        eventTypeId: dto.eventTypeId ?? null,
        label: dto.label.trim(),
        defaultDueDays: dto.defaultDueDays ?? 14,
      },
    });
  }

  async listDeliverableLabels() {
    return this.prisma.deliverableLabel.findMany({
      where: { isActive: true },
      orderBy: { label: 'asc' },
    });
  }

  async createTaskTemplate(dto: CreateTaskTemplateDto) {
    await this.assertEventTypeExists(dto.eventTypeId);
    return this.prisma.taskTemplate.create({
      data: {
        eventTypeId: dto.eventTypeId ?? null,
        title: dto.title.trim(),
        roleLabel: dto.roleLabel.trim(),
        defaultOffsetDays: dto.defaultOffsetDays ?? 0,
      },
    });
  }

  async listTaskTemplates() {
    return this.prisma.taskTemplate.findMany({
      where: { isActive: true },
      orderBy: { defaultOffsetDays: 'asc' },
    });
  }
}
