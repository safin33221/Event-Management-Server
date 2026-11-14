import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { getPaginationParams } from '../../common/dto/pagination.dto.js';
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

  async listInquiries(query: ListInquiriesQueryDto) {
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
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.inquiry.count({ where }),
    ]);

    return { data: items, meta: { page, limit, total } };
  }

  async getInquiry(id: string) {
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id },
    });
    if (!inquiry) {
      throw new NotFoundException('Inquiry not found');
    }
    return inquiry;
  }

  async updateStatus(id: string, dto: UpdateInquiryStatusDto) {
    const existing = await this.prisma.inquiry.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Inquiry not found');
    }
    return this.prisma.inquiry.update({
      where: { id },
      data: { status: dto.status },
    });
  }
}
