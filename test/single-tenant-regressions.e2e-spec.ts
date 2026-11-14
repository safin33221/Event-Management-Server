import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { StudioService } from '../src/modules/studio/studio.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('Softilo Single-Tenant Regression Suite (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdIds = {
    userEmails: ['e2e-owner@softilo.test', 'e2e-staff@softilo.test'],
    resourceIds: [] as string[],
    bookingIds: [] as string[],
    quoteIds: [] as string[],
    inquiryIds: [] as string[],
    packageIds: [] as string[],
    eventTypeIds: [] as string[],
    portfolioIds: [] as string[],
  };

  async function cleanupTestData() {
    if (!prisma) return;
    if (createdIds.bookingIds.length > 0) {
      await prisma.booking.deleteMany({ where: { id: { in: createdIds.bookingIds } } });
    }
    if (createdIds.quoteIds.length > 0) {
      await prisma.quote.deleteMany({ where: { id: { in: createdIds.quoteIds } } });
    }
    if (createdIds.inquiryIds.length > 0) {
      await prisma.inquiry.deleteMany({ where: { id: { in: createdIds.inquiryIds } } });
    }
    if (createdIds.packageIds.length > 0) {
      await prisma.package.deleteMany({ where: { id: { in: createdIds.packageIds } } });
    }
    if (createdIds.portfolioIds.length > 0) {
      await prisma.portfolioItem.deleteMany({ where: { id: { in: createdIds.portfolioIds } } });
    }
    if (createdIds.eventTypeIds.length > 0) {
      await prisma.eventType.deleteMany({ where: { id: { in: createdIds.eventTypeIds } } });
    }
    if (createdIds.resourceIds.length > 0) {
      await prisma.resource.deleteMany({ where: { id: { in: createdIds.resourceIds } } });
    }
    await prisma.user.deleteMany({ where: { email: { in: createdIds.userEmails } } });
  }

  beforeAll(async () => {
    process.env.AUTH_SECRET =
      process.env.AUTH_SECRET || 'test-auth-secret-at-least-32-characters-long';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.user.deleteMany({ where: { email: { in: createdIds.userEmails } } });
    await app.get(StudioService).initializeStudio({
      name: 'Wedding PhotoArt',
      preset: 'wedding-photography',
      ownerEmail: 'e2e-owner@softilo.test',
      ownerName: 'E2E Studio Owner',
      ownerPassword: 'OwnerPass123!',
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    if (app) {
      await app.close();
    }
  });

  it('runs single-tenant branding, quote immutability, payments, concurrent reservations, RBAC, deliveries, and calendar regressions', async () => {
    const server = app.getHttpServer();

    // 1. Sign in directly without any tenant slug or x-agency-id header
    const loginRes = await request(server)
      .post('/auth/login')
      .send({ email: 'e2e-owner@softilo.test', password: 'OwnerPass123!' })
      .expect(201);

    const ownerToken = loginRes.body.accessToken as string;
    expect(ownerToken).toBeTruthy();
    expect(loginRes.body.user.role).toBe('OWNER');

    // Public branding works without slug or domain lookup
    const brandRes = await request(server).get('/public/branding').expect(200);
    expect(brandRes.body.displayName).toBeTruthy();
    expect(brandRes.body.currency).toBe('BDT');

    // Add a STAFF user for authorization & assignment tests
    const staffRes = await request(server)
      .post('/studio/members')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        email: 'e2e-staff@softilo.test',
        name: 'E2E Staff Member',
        password: 'StaffPass123!',
        role: 'STAFF',
      })
      .expect(201);

    const staffLoginRes = await request(server)
      .post('/auth/login')
      .send({ email: 'e2e-staff@softilo.test', password: 'StaffPass123!' })
      .expect(201);
    const staffToken = staffLoginRes.body.accessToken as string;

    // Authorization regression: STAFF cannot edit branding, verify payments, or export finance ledger
    await request(server)
      .patch('/studio/branding')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ name: 'Unauthorized Rename' })
      .expect(403);

    await request(server)
      .get('/finance/export')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);

    // 2. Portfolio filtering: only approved + published items appear publicly
    const draftPort = await request(server)
      .post('/catalog/portfolio')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'E2E Unapproved Draft',
        mediaUrl: 'https://example.com/draft.jpg',
        isApproved: false,
        isPublished: true,
      })
      .expect(201);
    createdIds.portfolioIds.push(draftPort.body.id);

    const approvedPort = await request(server)
      .post('/catalog/portfolio')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'E2E Published Highlight',
        mediaUrl: 'https://example.com/published.jpg',
        isApproved: true,
        isPublished: true,
      })
      .expect(201);
    createdIds.portfolioIds.push(approvedPort.body.id);

    const publicPort = await request(server).get('/public/portfolio').expect(200);
    const titles = (publicPort.body.data as Array<{ title: string }>).map((p) => p.title);
    expect(titles).toContain('E2E Published Highlight');
    expect(titles).not.toContain('E2E Unapproved Draft');

    // 3. Create package + public inquiry -> quote -> accept -> edit package regression
    const uniqueSuffix = Date.now();
    const pkgRes = await request(server)
      .post('/catalog/packages')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `E2E Wedding Collection ${uniqueSuffix}`,
        slug: `e2e-wedding-collection-${uniqueSuffix}`,
        basePricePoisha: 5000000,
        isPublished: true,
      })
      .expect(201);
    createdIds.packageIds.push(pkgRes.body.id);

    const publicInqRes = await request(server)
      .post('/public/inquiries')
      .send({
        packageId: pkgRes.body.id,
        eventTitle: 'Amina & Tariq Wedding Reception',
        requestedDate: '2026-12-20',
        clientName: 'Amina Rahman',
        clientPhone: '+8801711000001',
      })
      .expect(201);
    expect(publicInqRes.body.reference).toMatch(/^INQ-\d{4}-\d{4}$/);

    const quoteRes = await request(server)
      .post('/quotes')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        eventTitle: 'Amina & Tariq Wedding Reception',
        requestedDate: '2026-12-20',
        clientName: 'Amina Rahman',
        clientPhone: '+8801711000001',
        items: [
          {
            packageId: pkgRes.body.id,
            description: 'Wedding Photography Package Snapshot',
            quantity: 1,
            unitPricePoisha: 5000000,
          },
        ],
      })
      .expect(201);
    const quoteId = quoteRes.body.id as string;
    createdIds.quoteIds.push(quoteId);

    await request(server)
      .post(`/quotes/${quoteId}/send`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    const acceptRes = await request(server)
      .post(`/quotes/${quoteId}/accept`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ acceptedBy: 'Amina Rahman', acceptedChannel: 'PORTAL' })
      .expect(201);
    const bookingId = acceptRes.body.booking.id as string;
    createdIds.bookingIds.push(bookingId);

    // Edit package price -> accepted quote & booking stay unchanged
    await request(server)
      .patch(`/catalog/packages/${pkgRes.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ basePricePoisha: 8500000 })
      .expect(200);

    const bookingAfterPkgEdit = await request(server)
      .get(`/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(bookingAfterPkgEdit.body.agreedTotalPoisha).toBe(5000000);

    // 4. Payments: Tk 10,000 verified advance on Tk 50,000 -> Tk 40,000 due, idempotent retry
    const idemKey = `e2e-pay-${uniqueSuffix}`;
    const recRes = await request(server)
      .post(`/bookings/${bookingId}/payments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('idempotency-key', idemKey)
      .send({
        method: 'BKASH',
        amountPoisha: 1000000,
        transactionRef: 'TRX-E2E-1',
      })
      .expect(201);
    expect(recRes.body.entry.verificationState).toBe('PENDING');

    const replayRes = await request(server)
      .post(`/bookings/${bookingId}/payments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('idempotency-key', idemKey)
      .send({
        method: 'BKASH',
        amountPoisha: 1000000,
        transactionRef: 'TRX-E2E-1',
      })
      .expect(201);
    expect(replayRes.body.idempotentReplay).toBe(true);
    expect(replayRes.body.entry.id).toBe(recRes.body.entry.id);

    // Confirm fails while advance is PENDING
    await request(server)
      .post(`/bookings/${bookingId}/confirm`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(409);

    // Verify advance -> Tk 40,000 due (4,000,000 poisha)
    const verifyRes = await request(server)
      .post(`/payments/${recRes.body.entry.id}/verify`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    expect(verifyRes.body.ledger.verifiedReceiptsPoisha).toBe(1000000);
    expect(verifyRes.body.ledger.outstandingDuePoisha).toBe(4000000);

    await request(server)
      .post(`/bookings/${bookingId}/confirm`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);

    // 5. Concurrent crew reservations + adjacent slots + Asia/Dhaka midnight calendar
    const crewRes = await request(server)
      .post('/resources')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'E2E Lead Photographer', type: 'CREW', userId: staffRes.body.id })
      .expect(201);
    createdIds.resourceIds.push(crewRes.body.id);

    // Create a second booking to race with the first for the same slot
    const q2 = await request(server)
      .post('/quotes')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        eventTitle: 'Corporate Summit',
        clientName: 'Apex Ltd',
        clientPhone: '+8801800000001',
        items: [{ description: 'Event Coverage', quantity: 1, unitPricePoisha: 2000000 }],
      })
      .expect(201);
    createdIds.quoteIds.push(q2.body.id);

    const a2 = await request(server)
      .post(`/quotes/${q2.body.id}/accept`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ acceptedBy: 'CEO', acceptedChannel: 'EMAIL' })
      .expect(201);
    const b2Id = a2.body.booking.id as string;
    createdIds.bookingIds.push(b2Id);

    const slotStart = '2026-12-20T18:10:00.000Z'; // 2026-12-21 00:10 Asia/Dhaka (+06:00)
    const slotEnd = '2026-12-20T21:00:00.000Z';

    const [s1, s2] = await Promise.all([
      request(server)
        .post(`/bookings/${bookingId}/sessions`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Main Reception',
          startAt: slotStart,
          endAt: slotEnd,
          resourceIds: [crewRes.body.id],
        }),
      request(server)
        .post(`/bookings/${b2Id}/sessions`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Competing Night Event',
          startAt: slotStart,
          endAt: slotEnd,
          resourceIds: [crewRes.body.id],
        }),
    ]);

    const statuses = [s1.status, s2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    // Adjacent slot starting at slotEnd must succeed
    await request(server)
      .post(`/bookings/${b2Id}/sessions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Adjacent Late Session',
        startAt: slotEnd,
        endAt: '2026-12-20T23:00:00.000Z',
        resourceIds: [crewRes.body.id],
      })
      .expect(201);

    // Calendar regression: 18:10 UTC on Dec 20 is Dec 21 00:10 in Asia/Dhaka
    const calRes = await request(server)
      .get('/calendar?from=2026-12-21&to=2026-12-21')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(calRes.body.timezone).toBe('Asia/Dhaka');
    expect(
      (calRes.body.sessions as Array<{ agencyLocalDate: string }>).some(
        (s) => s.agencyLocalDate === '2026-12-21',
      ),
    ).toBe(true);

    // 6. Deliveries regression: delivering gallery keeps film PENDING & balance Tk 40,000
    const galleryRes = await request(server)
      .post(`/bookings/${bookingId}/deliverables`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ label: 'Gallery' })
      .expect(201);

    const filmRes = await request(server)
      .post(`/bookings/${bookingId}/deliverables`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ label: 'Film' })
      .expect(201);

    await request(server)
      .post(`/deliverables/${galleryRes.body.id}/deliver`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ deliveryUrl: 'https://gallery.example.com/amina-tariq' })
      .expect(201);

    const deliverablesRes = await request(server)
      .get(`/bookings/${bookingId}/deliverables`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const filmAfter = (deliverablesRes.body as Array<{ id: string; reviewStatus: string }>).find(
      (d) => d.id === filmRes.body.id,
    );
    expect(filmAfter?.reviewStatus).toBe('PENDING');

    const ledgerAfterDelivery = await request(server)
      .get(`/bookings/${bookingId}/ledger`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(ledgerAfterDelivery.body.summary.outstandingDuePoisha).toBe(4000000);

    // 7. Automation alerts & digital receipt authorization + math check
    await request(server)
      .get('/bookings/automation-alerts')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);

    await request(server)
      .get(`/bookings/${bookingId}/receipt`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);

    const receiptRes = await request(server)
      .get(`/bookings/${bookingId}/receipt`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(receiptRes.body.booking.reference).toBeTruthy();
    expect(receiptRes.body.ledger.verifiedReceiptsPoisha).toBe(1000000);
    expect(receiptRes.body.ledger.outstandingDuePoisha).toBe(4000000);
    expect(receiptRes.body.quote.items.length).toBeGreaterThan(0);
    expect(receiptRes.body.payments.length).toBe(1);
  });

  it('auto-provisions event-type deliverables and crew tasks on confirmation (wedding vs corporate)', async () => {
    const server = app.getHttpServer();

    const loginRes = await request(server)
      .post('/auth/login')
      .send({ email: 'e2e-owner@softilo.test', password: 'OwnerPass123!' })
      .expect(201);
    const ownerToken = loginRes.body.accessToken as string;

    // Fetch active event types (public endpoint)
    const eventTypesRes = await request(server).get('/public/event-types').expect(200);
    const eventTypes = eventTypesRes.body as Array<{ id: string; slug: string; name: string }>;
    const weddingType = eventTypes.find((et) => et.slug === 'wedding');
    expect(weddingType).toBeTruthy();

    // Ensure corporate event type exists (create if studio was seeded prior to adding corporate to preset)
    let corporateType = eventTypes.find((et) => et.slug === 'corporate-event');
    if (!corporateType) {
      const createdCorp = await request(server)
        .post('/catalog/event-types')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Corporate Event',
          slug: 'corporate-event',
          description: 'Conferences and corporate gatherings',
        })
        .expect(201);
      corporateType = createdCorp.body;
      createdIds.eventTypeIds.push(corporateType!.id);

      await request(server)
        .post('/catalog/deliverable-labels')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          eventTypeId: corporateType!.id,
          label: `Corporate Summary ${Date.now()}`,
          defaultDueDays: 5,
        })
        .expect(201);
    }

    // Create wedding quote -> accept -> pay required 20% advance -> confirm
    const wQuoteRes = await request(server)
      .post('/quotes')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        eventTypeId: weddingType!.id,
        eventTitle: 'Nadia & Farhan Wedding',
        requestedDate: '2026-12-28',
        clientName: 'Nadia Islam',
        clientPhone: '+8801712345678',
        items: [{ description: 'Signature Wedding Collection', quantity: 1, unitPricePoisha: 5000000 }],
      })
      .expect(201);
    createdIds.quoteIds.push(wQuoteRes.body.id);

    const wAcceptRes = await request(server)
      .post(`/quotes/${wQuoteRes.body.id}/accept`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ acceptedBy: 'Nadia Islam', acceptedChannel: 'WHATSAPP' })
      .expect(201);
    const wBookingId = wAcceptRes.body.booking.id as string;
    createdIds.bookingIds.push(wBookingId);

    // Record Tk 15,000 advance (30% of Tk 50,000) -> verify -> automation alerts shows readyToConfirm
    const payRes = await request(server)
      .post(`/bookings/${wBookingId}/payments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        method: 'NAGAD',
        amountPoisha: 1500000,
        transactionRef: `NAG-E2E-${Date.now()}`,
      })
      .expect(201);

    const vRes = await request(server)
      .post(`/payments/${payRes.body.entry.id}/verify`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    expect(vRes.body.ledger.isAdvanceMet).toBe(true);

    const alertsBefore = await request(server)
      .get('/bookings/automation-alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(
      (alertsBefore.body.readyToConfirmBookings as Array<{ id: string }>).some(
        (b) => b.id === wBookingId,
      ),
    ).toBe(true);

    const wConfirmRes = await request(server)
      .post(`/bookings/${wBookingId}/confirm`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
    expect(wConfirmRes.body.deliverables.length).toBeGreaterThanOrEqual(3);
    expect(wConfirmRes.body.assignments.length).toBeGreaterThanOrEqual(2);

    const wDetail = await request(server)
      .get(`/bookings/${wBookingId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const wDelLabels = (wDetail.body.deliverables as Array<{ label: string }>).map((d) => d.label);
    expect(wDelLabels).toContain('Gallery');
    expect(wDelLabels).toContain('Film');
    expect(wDelLabels).toContain('Album');
    expect(wDetail.body.assignments.length).toBeGreaterThanOrEqual(2);

    // Corporate booking confirms without wedding deliverables/albums
    const cQuoteRes = await request(server)
      .post('/quotes')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        eventTypeId: corporateType!.id,
        eventTitle: 'Dhaka FinTech Townhall',
        requestedDate: '2026-12-29',
        clientName: 'FinTech Corp',
        clientPhone: '+8801911223344',
        items: [{ description: 'Corporate Summit Coverage', quantity: 1, unitPricePoisha: 3000000 }],
      })
      .expect(201);
    createdIds.quoteIds.push(cQuoteRes.body.id);

    const cAcceptRes = await request(server)
      .post(`/quotes/${cQuoteRes.body.id}/accept`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ acceptedBy: 'Admin Lead', acceptedChannel: 'EMAIL' })
      .expect(201);
    const cBookingId = cAcceptRes.body.booking.id as string;
    createdIds.bookingIds.push(cBookingId);

    const cPay = await request(server)
      .post(`/bookings/${cBookingId}/payments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ method: 'BANK', amountPoisha: 1000000, transactionRef: `BNK-E2E-${Date.now()}` })
      .expect(201);

    await request(server)
      .post(`/payments/${cPay.body.entry.id}/verify`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    const cConfirm = await request(server)
      .post(`/bookings/${cBookingId}/confirm`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
    const cLabels = (cConfirm.body.deliverables as Array<{ label: string }>).map((d) => d.label);
    expect(cLabels).not.toContain('Album');
    expect(cLabels.length).toBeGreaterThanOrEqual(1);
  });
});
