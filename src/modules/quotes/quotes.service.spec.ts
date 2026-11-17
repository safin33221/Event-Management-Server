import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  AcceptanceChannel,
  InquiryStatus,
  QuoteStatus,
  QuoteVersionStatus,
} from '../../generated/prisma/client.js';
import { QuotesService } from './quotes.service.js';

describe('QuotesService (Inquiry -> Quote -> Accept)', () => {
  const makeTxMock = () => ({
    quote: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn(),
      update: vi.fn(),
    },
    quoteVersion: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn(),
      update: vi.fn(),
    },
    inquiry: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    booking: {
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  });

  const makePrismaMock = (tx: ReturnType<typeof makeTxMock>) => ({
    inquiry: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    eventType: {
      findUnique: vi.fn().mockResolvedValue({ id: 'et-1' }),
    },
    package: {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(1),
    },
    serviceItem: {
      count: vi.fn().mockResolvedValue(1),
    },
    quote: {
      findUnique: vi.fn(),
    },
    quoteVersion: {
      findFirst: vi.fn(),
    },
    nextReference: vi.fn().mockResolvedValue('QUO-2026-0001'),
    $transaction: vi.fn(async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx)),
  });

  it('creates a quote from a NEW inquiry, inherits eventTypeId, and marks inquiry QUOTED', async () => {
    const tx = makeTxMock();
    const prisma = makePrismaMock(tx);
    prisma.inquiry.findUnique.mockResolvedValue({
      id: 'inq-1',
      reference: 'INQ-2026-0001',
      status: InquiryStatus.NEW,
      eventTypeId: 'et-wedding',
      packageId: null,
      quotes: [],
    });

    tx.quote.create.mockResolvedValue({
      id: 'quo-1',
      inquiryId: 'inq-1',
      reference: 'QUO-2026-0001',
      eventTypeId: 'et-wedding',
      eventTitle: 'Ayesha & Rafiq Wedding',
      requestedDate: new Date('2026-12-10T00:00:00.000Z'),
      clientName: 'Ayesha',
      clientPhone: '+8801711000001',
      clientEmail: 'ayesha@example.com',
      currency: 'BDT',
      status: QuoteStatus.DRAFT,
    });
    tx.quoteVersion.create.mockResolvedValue({
      id: 'qv-1',
      quoteId: 'quo-1',
      versionNumber: 1,
      subtotalPoisha: 5000000n,
      discountPoisha: 0n,
      totalPoisha: 5000000n,
      terms: 'Advance 40%',
      validUntil: null,
      status: QuoteVersionStatus.DRAFT,
      acceptedAt: null,
      acceptedBy: null,
      acceptedChannel: null,
      createdAt: new Date(),
      items: [
        {
          id: 'qi-1',
          packageId: null,
          serviceItemId: null,
          description: 'Full Wedding Coverage',
          quantity: 1,
          unitPricePoisha: 5000000n,
          lineTotalPoisha: 5000000n,
          sortOrder: 0,
        },
      ],
    });
    tx.quote.update.mockResolvedValue({
      id: 'quo-1',
      inquiryId: 'inq-1',
      reference: 'QUO-2026-0001',
      eventTypeId: 'et-wedding',
      eventTitle: 'Ayesha & Rafiq Wedding',
      requestedDate: new Date('2026-12-10T00:00:00.000Z'),
      clientName: 'Ayesha',
      clientPhone: '+8801711000001',
      clientEmail: 'ayesha@example.com',
      currency: 'BDT',
      status: QuoteStatus.DRAFT,
      currentVersionId: 'qv-1',
    });

    const service = new QuotesService(prisma as never);
    const result = await service.createQuote('BDT', {
      inquiryId: 'inq-1',
      eventTitle: 'Ayesha & Rafiq Wedding',
      requestedDate: '2026-12-10',
      clientName: 'Ayesha',
      clientPhone: '+8801711000001',
      clientEmail: 'ayesha@example.com',
      items: [{ description: 'Full Wedding Coverage', quantity: 1, unitPricePoisha: 5000000 }],
      terms: 'Advance 40%',
    });

    expect(result.reference).toBe('QUO-2026-0001');
    expect(result.eventTypeId).toBe('et-wedding');
    expect(result.currentVersion.totalPoisha).toBe(5000000);
    expect(result.versions).toHaveLength(1);
    expect(tx.inquiry.update).toHaveBeenCalledWith({
      where: { id: 'inq-1' },
      data: { status: InquiryStatus.QUOTED },
    });
  });

  it('allows creating a replacement quote from a QUOTED inquiry and supersedes open quotes', async () => {
    const tx = makeTxMock();
    const prisma = makePrismaMock(tx);
    prisma.inquiry.findUnique.mockResolvedValue({
      id: 'inq-2',
      reference: 'INQ-2026-0002',
      status: InquiryStatus.QUOTED,
      eventTypeId: null,
      packageId: null,
      quotes: [],
    });
    tx.quote.findMany.mockResolvedValue([{ id: 'old-q-1' }]);
    tx.quote.create.mockResolvedValue({
      id: 'quo-2',
      inquiryId: 'inq-2',
      reference: 'QUO-2026-0002',
      status: QuoteStatus.DRAFT,
    });
    tx.quoteVersion.create.mockResolvedValue({
      id: 'qv-2',
      quoteId: 'quo-2',
      versionNumber: 1,
      subtotalPoisha: 3000000n,
      discountPoisha: 500000n,
      totalPoisha: 2500000n,
      terms: null,
      validUntil: null,
      status: QuoteVersionStatus.DRAFT,
      acceptedAt: null,
      acceptedBy: null,
      acceptedChannel: null,
      createdAt: new Date(),
      items: [],
    });
    tx.quote.update.mockResolvedValue({
      id: 'quo-2',
      inquiryId: 'inq-2',
      reference: 'QUO-2026-0002',
      currentVersionId: 'qv-2',
    });

    const service = new QuotesService(prisma as never);
    await service.createQuote('BDT', {
      inquiryId: 'inq-2',
      eventTitle: 'Corporate Summit',
      clientName: 'Karim',
      clientPhone: '+8801811000002',
      items: [{ description: 'Photography + Video', quantity: 1, unitPricePoisha: 3000000 }],
      discountPoisha: 500000,
    });

    expect(tx.quoteVersion.updateMany).toHaveBeenCalledWith({
      where: {
        quoteId: { in: ['old-q-1'] },
        status: { in: [QuoteVersionStatus.DRAFT, QuoteVersionStatus.SENT] },
      },
      data: { status: QuoteVersionStatus.SUPERSEDED },
    });
    expect(tx.quote.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['old-q-1'] } },
      data: { status: QuoteStatus.SUPERSEDED },
    });
  });

  it('rejects creating a quote for CONVERTED or CLOSED inquiries with ConflictException', async () => {
    const tx = makeTxMock();
    const prisma = makePrismaMock(tx);
    const service = new QuotesService(prisma as never);

    prisma.inquiry.findUnique.mockResolvedValueOnce({
      id: 'inq-closed',
      reference: 'INQ-2026-0003',
      status: InquiryStatus.CLOSED,
      eventTypeId: null,
      packageId: null,
      quotes: [],
    });
    await expect(
      service.createQuote('BDT', {
        inquiryId: 'inq-closed',
        eventTitle: 'Closed Event',
        clientName: 'Test',
        clientPhone: '+8801700000000',
        items: [{ description: 'Package', quantity: 1, unitPricePoisha: 100000 }],
      }),
    ).rejects.toThrow(ConflictException);

    prisma.inquiry.findUnique.mockResolvedValueOnce({
      id: 'inq-conv',
      reference: 'INQ-2026-0004',
      status: InquiryStatus.CONVERTED,
      eventTypeId: null,
      packageId: null,
      quotes: [{ id: 'q-acc', reference: 'QUO-1', booking: { id: 'b-1', reference: 'BKG-1', status: 'CONFIRMED' } }],
    });
    await expect(
      service.createQuote('BDT', {
        inquiryId: 'inq-conv',
        eventTitle: 'Converted Event',
        clientName: 'Test',
        clientPhone: '+8801700000000',
        items: [{ description: 'Package', quantity: 1, unitPricePoisha: 100000 }],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects empty client/title fields, zero subtotal, or discount >= subtotal cleanly', async () => {
    const tx = makeTxMock();
    const prisma = makePrismaMock(tx);
    const service = new QuotesService(prisma as never);

    await expect(
      service.createQuote('BDT', {
        eventTitle: '   ',
        clientName: 'Test',
        clientPhone: '+8801700000000',
        items: [{ description: 'Package', quantity: 1, unitPricePoisha: 100000 }],
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createQuote('BDT', {
        eventTitle: 'Birthday',
        clientName: 'Test',
        clientPhone: '+8801700000000',
        items: [{ description: 'Free Item', quantity: 1, unitPricePoisha: 0 }],
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createQuote('BDT', {
        eventTitle: 'Birthday',
        clientName: 'Test',
        clientPhone: '+8801700000000',
        items: [{ description: 'Coverage', quantity: 1, unitPricePoisha: 100000 }],
        discountPoisha: 100000,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a quote, converts linked inquiry to CONVERTED, and creates a booking', async () => {
    const tx = makeTxMock();
    const prisma = makePrismaMock(tx);
    prisma.nextReference.mockResolvedValueOnce('BKG-2026-0009');
    prisma.quote.findUnique.mockResolvedValue({
      id: 'quo-acc',
      inquiryId: 'inq-acc',
      reference: 'QUO-2026-0009',
      eventTypeId: null,
      eventTitle: 'Holud Night',
      requestedDate: null,
      clientName: 'Sadia',
      clientPhone: '+8801900000001',
      clientEmail: null,
      currency: 'BDT',
      status: QuoteStatus.SENT,
      currentVersionId: 'qv-acc',
      booking: null,
    });
    prisma.quoteVersion.findFirst.mockResolvedValue({
      id: 'qv-acc',
      quoteId: 'quo-acc',
      versionNumber: 1,
      subtotalPoisha: 2000000n,
      discountPoisha: 0n,
      totalPoisha: 2000000n,
      terms: null,
      validUntil: null,
      status: QuoteVersionStatus.SENT,
    });
    tx.quoteVersion.update.mockResolvedValue({
      id: 'qv-acc',
      quoteId: 'quo-acc',
      versionNumber: 1,
      subtotalPoisha: 2000000n,
      discountPoisha: 0n,
      totalPoisha: 2000000n,
      terms: null,
      validUntil: null,
      status: QuoteVersionStatus.ACCEPTED,
      acceptedAt: new Date(),
      acceptedBy: 'Sadia',
      acceptedChannel: AcceptanceChannel.PHONE,
      createdAt: new Date(),
      items: [],
    });
    tx.booking.create.mockResolvedValue({
      id: 'bkg-9',
      reference: 'BKG-2026-0009',
      agreedTotalPoisha: 2000000n,
      status: 'PENDING_CONFIRMATION',
    });

    const service = new QuotesService(prisma as never);
    const res = await service.acceptQuote('quo-acc', 'user-1', {
      acceptedBy: 'Sadia',
      acceptedChannel: AcceptanceChannel.PHONE,
    });

    expect(res.booking.reference).toBe('BKG-2026-0009');
    expect(res.booking.agreedTotalPoisha).toBe(2000000);
    expect(tx.inquiry.update).toHaveBeenCalledWith({
      where: { id: 'inq-acc' },
      data: { status: InquiryStatus.CONVERTED },
    });
  });

  it('generates a valid PDF invoice/proposal buffer for a quote', async () => {
    const tx = makeTxMock();
    const prisma = makePrismaMock(tx);
    prisma.quote.findUnique.mockResolvedValue({
      id: 'quo-pdf',
      reference: 'QUO-2026-0023',
      status: QuoteStatus.DRAFT,
      eventTitle: 'Amina & Tariq Wedding Reception',
      eventType: { name: 'Wedding' },
      requestedDate: new Date('2026-12-20T00:00:00.000Z'),
      clientName: 'Amina Rahman',
      clientPhone: '+8801711000011',
      clientEmail: 'amina@example.com',
      currency: 'BDT',
      currentVersionId: 'qv-pdf',
      createdAt: new Date(),
      versions: [
        {
          id: 'qv-pdf',
          versionNumber: 1,
          status: QuoteVersionStatus.DRAFT,
          subtotalPoisha: 5000000n,
          discountPoisha: 100000n,
          totalPoisha: 4900000n,
          terms: 'Advance 40% to confirm booking.',
          validUntil: null,
          createdAt: new Date(),
          items: [
            {
              id: 'item-1',
              description: 'Full Wedding Photo + Cinema Package',
              quantity: 1,
              unitPricePoisha: 5000000n,
              lineTotalPoisha: 5000000n,
            },
          ],
        },
      ],
    });

    const service = new QuotesService(prisma as never);
    const pdf = await service.getQuoteInvoicePdf('quo-pdf');
    expect(pdf.filename).toBe('quote-quo-2026-0023-v1.pdf');
    expect(pdf.buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(pdf.buffer.length).toBeGreaterThan(1000);
  });
});
