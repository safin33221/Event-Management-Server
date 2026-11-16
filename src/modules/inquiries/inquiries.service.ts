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
import { toJsonPoisha } from '../../common/money/money.js';
import {
  CreateInquiryDto,
  ListInquiriesQueryDto,
  UpdateInquiryStatusDto,
} from './dto/inquiries.dto.js';

@Injectable()
export class InquiriesService {
  constructor(private readonly prisma: PrismaService) {}

  async createInquiry(
    dto: CreateInquiryDto,
    source: 'PUBLIC' | 'PHONE' | 'INTERNAL' = 'INTERNAL',
  ) {
    if (dto.eventTypeId) {
      const et = await this.prisma.eventType.findUnique({
        where: { id: dto.eventTypeId },
        select: { id: true },
      });
      if (!et) throw new BadRequestException('EventType not found');
    }
    if (dto.packageId) {
      const pkg = await this.prisma.package.findUnique({
        where: { id: dto.packageId },
        select: { id: true },
      });
      if (!pkg) throw new BadRequestException('Package not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const reference = await this.prisma.nextReference(tx, 'INQ');
      return tx.inquiry.create({
        data: {
          reference,
          eventTypeId: dto.eventTypeId ?? null,
          packageId: dto.packageId ?? null,
          eventTitle: dto.eventTitle.trim(),
          requestedDate: dto.requestedDate
            ? new Date(`${dto.requestedDate}T00:00:00.000Z`)
            : null,
          clientName: dto.clientName.trim(),
          clientPhone: dto.clientPhone.trim(),
          clientEmail: dto.clientEmail?.trim().toLowerCase() ?? null,
          notes: dto.notes ?? null,
          metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          source,
        },
      });
    });
  }

  /**
   * Self-heals inquiry statuses so any inquiry whose quote was accepted or converted to a booking
   * is guaranteed to be marked CONVERTED (and never stays stuck in NEW/QUOTED).
   */
  private async reconcileInquiryPipeline(): Promise<void> {
    if (
      typeof this.prisma.inquiry?.updateMany !== 'function' ||
      typeof this.prisma.quote?.findMany !== 'function'
    ) {
      return;
    }

    // 1. Auto-link unlinked quotes that match an open inquiry by phone + eventTitle
    const unlinkedQuotes = await this.prisma.quote.findMany({
      where: { inquiryId: null },
      select: { id: true, clientPhone: true, eventTitle: true, status: true, booking: { select: { id: true } } },
      take: 100,
    });
    for (const q of unlinkedQuotes) {
      const matchingInquiry = await this.prisma.inquiry.findFirst({
        where: {
          clientPhone: q.clientPhone,
          eventTitle: { equals: q.eventTitle, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (matchingInquiry) {
        await this.prisma.quote.update({
          where: { id: q.id },
          data: { inquiryId: matchingInquiry.id },
        });
      }
    }

    // 2. Any inquiry with an ACCEPTED quote or an existing Booking must be CONVERTED
    await this.prisma.inquiry.updateMany({
      where: {
        status: { not: InquiryStatus.CONVERTED },
        quotes: {
          some: {
            OR: [{ status: QuoteStatus.ACCEPTED }, { booking: { isNot: null } }],
          },
        },
      },
      data: { status: InquiryStatus.CONVERTED },
    });

    // 3. Any NEW/QUALIFIED inquiry with a DRAFT or SENT quote must be QUOTED
    await this.prisma.inquiry.updateMany({
      where: {
        status: { in: [InquiryStatus.NEW, InquiryStatus.QUALIFIED] },
        quotes: {
          some: {
            status: { in: [QuoteStatus.DRAFT, QuoteStatus.SENT] },
          },
        },
      },
      data: { status: InquiryStatus.QUOTED },
    });
  }

  async listInquiries(query: ListInquiriesQueryDto) {
    await this.reconcileInquiryPipeline();

    const { page, limit, skip } = getPaginationParams(query);
    const where: Prisma.InquiryWhereInput = {
      status: query.status,
      reference: query.reference ? { contains: query.reference.trim(), mode: 'insensitive' } : undefined,
      requestedDate: query.requestedDate
        ? new Date(`${query.requestedDate}T00:00:00.000Z`)
        : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.inquiry.findMany({
        where,
        include: {
          eventType: { select: { id: true, name: true, slug: true } },
          package: { select: { id: true, name: true, slug: true, basePricePoisha: true } },
          quotes: {
            where: {
              status: { notIn: [QuoteStatus.SUPERSEDED, QuoteStatus.CANCELLED] },
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              versions: {
                orderBy: { versionNumber: 'desc' },
                take: 1,
                select: {
                  id: true,
                  versionNumber: true,
                  totalPoisha: true,
                  status: true,
                },
              },
              booking: {
                select: {
                  id: true,
                  reference: true,
                  status: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.inquiry.count({ where }),
    ]);

    const serialized = items.map((inq) => {
      const latestQuote = inq.quotes?.[0] ?? null;
      const latestVersion = latestQuote?.versions?.[0] ?? null;
      return {
        ...inq,
        package: inq.package
          ? {
              ...inq.package,
              basePricePoisha: toJsonPoisha(inq.package.basePricePoisha),
            }
          : null,
        activeQuote: latestQuote
          ? {
              id: latestQuote.id,
              reference: latestQuote.reference,
              status: latestQuote.status,
              currency: latestQuote.currency,
              totalPoisha: latestVersion ? toJsonPoisha(latestVersion.totalPoisha) : null,
              versionNumber: latestVersion?.versionNumber ?? 1,
              booking: latestQuote.booking ?? null,
            }
          : null,
      };
    });

    return { data: serialized, meta: { page, limit, total } };
  }

  async getInquiry(id: string) {
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id },
      include: {
        eventType: { select: { id: true, name: true, slug: true } },
        package: { select: { id: true, name: true, slug: true, basePricePoisha: true } },
        quotes: {
          orderBy: { createdAt: 'desc' },
          include: {
            booking: { select: { id: true, reference: true, status: true } },
          },
        },
      },
    });
    if (!inquiry) {
      throw new NotFoundException('Inquiry not found');
    }
    return {
      ...inquiry,
      package: inquiry.package
        ? {
            ...inquiry.package,
            basePricePoisha: toJsonPoisha(inquiry.package.basePricePoisha),
          }
        : null,
    };
  }

  async updateStatus(id: string, dto: UpdateInquiryStatusDto) {
    const existing = await this.prisma.inquiry.findUnique({
      where: { id },
      include: {
        quotes: {
          include: { booking: { select: { id: true, reference: true, status: true } } },
        },
      },
    });
    if (!existing) {
      throw new NotFoundException('Inquiry not found');
    }

    const acceptedOrBooked = existing.quotes.find(
      (q) => q.status === QuoteStatus.ACCEPTED || Boolean(q.booking),
    );
    if (
      (existing.status === InquiryStatus.CONVERTED || acceptedOrBooked) &&
      dto.status !== InquiryStatus.CONVERTED
    ) {
      throw new ConflictException(
        `Inquiry ${existing.reference} has already been converted to a booking and cannot be moved back to ${dto.status}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.status === InquiryStatus.CLOSED) {
        const openQuotes = existing.quotes.filter(
          (q) => q.status === QuoteStatus.DRAFT || q.status === QuoteStatus.SENT,
        );
        for (const q of openQuotes) {
          await tx.quoteVersion.updateMany({
            where: {
              quoteId: q.id,
              status: { in: [QuoteVersionStatus.DRAFT, QuoteVersionStatus.SENT] },
            },
            data: { status: QuoteVersionStatus.SUPERSEDED },
          });
          await tx.quote.update({
            where: { id: q.id },
            data: { status: QuoteStatus.CANCELLED },
          });
        }
      }

      return tx.inquiry.update({
        where: { id },
        data: { status: dto.status },
      });
    });
  }
}
