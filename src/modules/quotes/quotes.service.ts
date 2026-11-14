import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InquiryStatus,
  Prisma,
  QuoteStatus,
  QuoteVersionStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { getPaginationParams } from '../../common/dto/pagination.dto.js';
import { sumPoisha, toJsonPoisha, toPoisha } from '../../common/money/money.js';
import {
  AcceptQuoteDto,
  CreateQuoteDto,
  CreateQuoteVersionDto,
  ListQuotesQueryDto,
  QuoteLineItemInputDto,
} from './dto/quotes.dto.js';

@Injectable()
export class QuotesService {
  constructor(private readonly prisma: PrismaService) {}

  private computeTotals(items: QuoteLineItemInputDto[], discountInput = 0) {
    const computedItems = items.map((item, idx) => {
      const unitPrice = toPoisha(item.unitPricePoisha);
      const quantity = BigInt(item.quantity);
      const lineTotal = unitPrice * quantity;
      return {
        packageId: item.packageId ?? null,
        serviceItemId: item.serviceItemId ?? null,
        description: item.description.trim(),
        quantity: item.quantity,
        unitPricePoisha: unitPrice,
        lineTotalPoisha: lineTotal,
        sortOrder: idx,
      };
    });

    const subtotalPoisha = sumPoisha(computedItems.map((i) => i.lineTotalPoisha));
    const discountPoisha = toPoisha(discountInput);
    if (discountPoisha > subtotalPoisha) {
      throw new BadRequestException('Discount cannot exceed quote subtotal');
    }
    const totalPoisha = subtotalPoisha - discountPoisha;

    return { computedItems, subtotalPoisha, discountPoisha, totalPoisha };
  }

  private async validateItemReferences(items: QuoteLineItemInputDto[]) {
    const packageIds = [
      ...new Set(items.map((i) => i.packageId).filter((id): id is string => Boolean(id))),
    ];
    if (packageIds.length > 0) {
      const count = await this.prisma.package.count({
        where: { id: { in: packageIds } },
      });
      if (count !== packageIds.length) {
        throw new BadRequestException('One or more packages do not exist');
      }
    }

    const serviceIds = [
      ...new Set(items.map((i) => i.serviceItemId).filter((id): id is string => Boolean(id))),
    ];
    if (serviceIds.length > 0) {
      const count = await this.prisma.serviceItem.count({
        where: { id: { in: serviceIds } },
      });
      if (count !== serviceIds.length) {
        throw new BadRequestException('One or more service items do not exist');
      }
    }
  }

  private serializeVersion(v: {
    id: string;
    quoteId: string;
    versionNumber: number;
    subtotalPoisha: bigint;
    discountPoisha: bigint;
    totalPoisha: bigint;
    terms: string | null;
    validUntil: Date | null;
    status: QuoteVersionStatus;
    acceptedAt: Date | null;
    acceptedBy: string | null;
    acceptedChannel: string | null;
    createdAt: Date;
    items?: Array<{
      id: string;
      packageId: string | null;
      serviceItemId: string | null;
      description: string;
      quantity: number;
      unitPricePoisha: bigint;
      lineTotalPoisha: bigint;
      sortOrder: number;
    }>;
  }) {
    return {
      id: v.id,
      quoteId: v.quoteId,
      versionNumber: v.versionNumber,
      subtotalPoisha: toJsonPoisha(v.subtotalPoisha),
      discountPoisha: toJsonPoisha(v.discountPoisha),
      totalPoisha: toJsonPoisha(v.totalPoisha),
      terms: v.terms,
      validUntil: v.validUntil,
      status: v.status,
      acceptedAt: v.acceptedAt,
      acceptedBy: v.acceptedBy,
      acceptedChannel: v.acceptedChannel,
      createdAt: v.createdAt,
      items: v.items?.map((item) => ({
        id: item.id,
        packageId: item.packageId,
        serviceItemId: item.serviceItemId,
        description: item.description,
        quantity: item.quantity,
        unitPricePoisha: toJsonPoisha(item.unitPricePoisha),
        lineTotalPoisha: toJsonPoisha(item.lineTotalPoisha),
        sortOrder: item.sortOrder,
      })),
    };
  }

  async createQuote(currency: string, dto: CreateQuoteDto) {
    if (dto.inquiryId) {
      const inquiry = await this.prisma.inquiry.findUnique({
        where: { id: dto.inquiryId },
        select: { id: true },
      });
      if (!inquiry) {
        throw new BadRequestException('Inquiry not found');
      }
    }
    if (dto.eventTypeId) {
      const et = await this.prisma.eventType.findUnique({
        where: { id: dto.eventTypeId },
        select: { id: true },
      });
      if (!et) {
        throw new BadRequestException('EventType not found');
      }
    }

    await this.validateItemReferences(dto.items);
    const { computedItems, subtotalPoisha, discountPoisha, totalPoisha } = this.computeTotals(
      dto.items,
      dto.discountPoisha ?? 0,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const reference = await this.prisma.nextReference(tx, 'QUO');
      const quote = await tx.quote.create({
        data: {
          inquiryId: dto.inquiryId ?? null,
          reference,
          eventTypeId: dto.eventTypeId ?? null,
          eventTitle: dto.eventTitle.trim(),
          requestedDate: dto.requestedDate
            ? new Date(`${dto.requestedDate}T00:00:00.000Z`)
            : null,
          clientName: dto.clientName.trim(),
          clientPhone: dto.clientPhone.trim(),
          clientEmail: dto.clientEmail?.trim().toLowerCase() ?? null,
          currency,
          status: QuoteStatus.DRAFT,
        },
      });

      const version = await tx.quoteVersion.create({
        data: {
          quoteId: quote.id,
          versionNumber: 1,
          subtotalPoisha,
          discountPoisha,
          totalPoisha,
          terms: dto.terms ?? null,
          validUntil: dto.validUntil ? new Date(`${dto.validUntil}T00:00:00.000Z`) : null,
          status: QuoteVersionStatus.DRAFT,
          items: {
            create: computedItems,
          },
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });

      const updatedQuote = await tx.quote.update({
        where: { id: quote.id },
        data: { currentVersionId: version.id },
      });

      if (dto.inquiryId) {
        await tx.inquiry.update({
          where: { id: dto.inquiryId },
          data: { status: InquiryStatus.QUOTED },
        });
      }

      return { quote: updatedQuote, version };
    });

    return {
      ...created.quote,
      currentVersion: this.serializeVersion(created.version),
    };
  }

  async createVersion(quoteId: string, dto: CreateQuoteVersionDto) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    if (!quote) {
      throw new NotFoundException('Quote not found');
    }
    if (quote.status === QuoteStatus.CANCELLED || quote.status === QuoteStatus.EXPIRED) {
      throw new ConflictException(`Cannot revise a quote in status ${quote.status}`);
    }

    await this.validateItemReferences(dto.items);
    const { computedItems, subtotalPoisha, discountPoisha, totalPoisha } = this.computeTotals(
      dto.items,
      dto.discountPoisha ?? 0,
    );

    const nextVersionNumber = (quote.versions[0]?.versionNumber ?? 0) + 1;

    const version = await this.prisma.$transaction(async (tx) => {
      // Mark prior DRAFT/SENT versions as SUPERSEDED (keep ACCEPTED untouched for history)
      await tx.quoteVersion.updateMany({
        where: {
          quoteId,
          status: { in: [QuoteVersionStatus.DRAFT, QuoteVersionStatus.SENT] },
        },
        data: { status: QuoteVersionStatus.SUPERSEDED },
      });

      const createdVersion = await tx.quoteVersion.create({
        data: {
          quoteId,
          versionNumber: nextVersionNumber,
          subtotalPoisha,
          discountPoisha,
          totalPoisha,
          terms: dto.terms ?? null,
          validUntil: dto.validUntil ? new Date(`${dto.validUntil}T00:00:00.000Z`) : null,
          status: QuoteVersionStatus.DRAFT,
          items: {
            create: computedItems,
          },
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });

      await tx.quote.update({
        where: { id: quoteId },
        data: {
          currentVersionId: createdVersion.id,
          status: quote.status === QuoteStatus.ACCEPTED ? QuoteStatus.ACCEPTED : QuoteStatus.DRAFT,
        },
      });

      return createdVersion;
    });

    return this.serializeVersion(version);
  }

  async sendQuote(quoteId: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
    });
    if (!quote || !quote.currentVersionId) {
      throw new NotFoundException('Quote not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.quoteVersion.update({
        where: { id: quote.currentVersionId! },
        data: { status: QuoteVersionStatus.SENT },
      });
      return tx.quote.update({
        where: { id: quoteId },
        data: { status: QuoteStatus.SENT },
      });
    });
  }

  async acceptQuote(quoteId: string, actorUserId: string, dto: AcceptQuoteDto) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { booking: true },
    });
    if (!quote) {
      throw new NotFoundException('Quote not found');
    }
    if (quote.status === QuoteStatus.CANCELLED || quote.status === QuoteStatus.EXPIRED) {
      throw new ConflictException(`Cannot accept quote in status ${quote.status}`);
    }

    const targetVersionId = dto.versionId ?? quote.currentVersionId;
    if (!targetVersionId) {
      throw new BadRequestException('No quote version available to accept');
    }

    const version = await this.prisma.quoteVersion.findFirst({
      where: { id: targetVersionId, quoteId },
    });
    if (!version) {
      throw new NotFoundException('Quote version not found');
    }
    if (version.status === QuoteVersionStatus.ACCEPTED) {
      throw new ConflictException('This quote version has already been accepted');
    }
    if (version.status === QuoteVersionStatus.SUPERSEDED) {
      throw new ConflictException('Cannot accept a superseded quote version');
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.quoteVersion.updateMany({
        where: { quoteId, status: QuoteVersionStatus.ACCEPTED },
        data: { status: QuoteVersionStatus.SUPERSEDED },
      });

      const acceptedVersion = await tx.quoteVersion.update({
        where: { id: version.id },
        data: {
          status: QuoteVersionStatus.ACCEPTED,
          acceptedAt: now,
          acceptedBy: dto.acceptedBy.trim(),
          acceptedChannel: dto.acceptedChannel,
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });

      await tx.quote.update({
        where: { id: quoteId },
        data: {
          status: QuoteStatus.ACCEPTED,
          currentVersionId: version.id,
        },
      });

      if (quote.inquiryId) {
        await tx.inquiry.update({
          where: { id: quote.inquiryId },
          data: { status: InquiryStatus.CONVERTED },
        });
      }

      let booking;
      if (quote.booking) {
        booking = await tx.booking.update({
          where: { id: quote.booking.id },
          data: {
            acceptedQuoteVersionId: acceptedVersion.id,
            agreedTotalPoisha: acceptedVersion.totalPoisha,
            version: { increment: 1 },
          },
        });
      } else {
        const bookingRef = await this.prisma.nextReference(tx, 'BKG');
        booking = await tx.booking.create({
          data: {
            reference: bookingRef,
            quoteId: quote.id,
            acceptedQuoteVersionId: acceptedVersion.id,
            eventTypeId: quote.eventTypeId,
            eventTitle: quote.eventTitle,
            eventDate: quote.requestedDate,
            clientName: quote.clientName,
            clientPhone: quote.clientPhone,
            clientEmail: quote.clientEmail,
            currency: quote.currency,
            agreedTotalPoisha: acceptedVersion.totalPoisha,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: actorUserId,
          entityType: 'Quote',
          entityId: quote.id,
          action: 'QUOTE_ACCEPTED',
          details: {
            quoteVersionId: acceptedVersion.id,
            versionNumber: acceptedVersion.versionNumber,
            acceptedBy: dto.acceptedBy.trim(),
            acceptedChannel: dto.acceptedChannel,
            bookingId: booking.id,
            bookingReference: booking.reference,
          },
        },
      });

      return {
        quoteId: quote.id,
        acceptedVersion: this.serializeVersion(acceptedVersion),
        booking: {
          ...booking,
          agreedTotalPoisha: toJsonPoisha(booking.agreedTotalPoisha),
        },
      };
    });
  }

  async listQuotes(query: ListQuotesQueryDto) {
    const { page, limit, skip } = getPaginationParams(query);
    const where: Prisma.QuoteWhereInput = {
      status: query.status,
      reference: query.reference ? { contains: query.reference.trim(), mode: 'insensitive' } : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.quote.findMany({
        where,
        include: {
          versions: {
            include: { items: { orderBy: { sortOrder: 'asc' } } },
            orderBy: { versionNumber: 'desc' },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.quote.count({ where }),
    ]);

    return {
      data: items.map((q) => ({
        ...q,
        versions: q.versions.map((v) => this.serializeVersion(v)),
      })),
      meta: { page, limit, total },
    };
  }

  async getQuote(id: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: {
        versions: {
          include: { items: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { versionNumber: 'desc' },
        },
      },
    });
    if (!quote) {
      throw new NotFoundException('Quote not found');
    }
    return {
      ...quote,
      versions: quote.versions.map((v) => this.serializeVersion(v)),
    };
  }
}
