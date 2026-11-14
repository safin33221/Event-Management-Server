import { BadRequestException, Injectable } from '@nestjs/common';
import { AdvancePolicyType, Prisma, StudioSettings, UserRole } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  ContactDetails,
  SOFTILO_DEFAULT_BRANDING,
  ThemeTokens,
  mergeWithDefaultTheme,
  validateLogoUrl,
  validateThemeTokens,
} from '../../common/branding/branding-defaults.js';
import { hashPassword } from '../../common/crypto/password.js';
import { toJsonPoisha, toPoisha } from '../../common/money/money.js';
import { isValidIanaTimezone } from '../../common/time/timezone.js';
import { AddMemberDto } from './dto/add-member.dto.js';
import { UpdateBrandingDto } from './dto/update-branding.dto.js';

export const DEFAULT_STUDIO_ID = 'default';

export interface PublicBrandingProjection {
  displayName: string;
  logoUrl: string | null;
  themeTokens: ThemeTokens;
  contactDetails: ContactDetails;
  timezone: string;
  currency: string;
}

export interface InitializeStudioOptions {
  name?: string;
  preset?: 'wedding-photography' | 'corporate' | 'neutral';
  timezone?: string;
  currency?: string;
  ownerEmail: string;
  ownerName: string;
  ownerPassword: string;
}

@Injectable()
export class StudioService {
  private brandingCache: PublicBrandingProjection | null = null;

  constructor(private readonly prisma: PrismaService) {}

  clearBrandingCache(): void {
    this.brandingCache = null;
  }

  toPublicBrandingProjection(settings: StudioSettings | null): PublicBrandingProjection {
    if (!settings) {
      return {
        displayName: SOFTILO_DEFAULT_BRANDING.displayName,
        logoUrl: SOFTILO_DEFAULT_BRANDING.logoUrl,
        themeTokens: { ...SOFTILO_DEFAULT_BRANDING.themeTokens },
        contactDetails: { ...SOFTILO_DEFAULT_BRANDING.contactDetails },
        timezone: 'Asia/Dhaka',
        currency: 'BDT',
      };
    }

    const contact =
      settings.contactDetails &&
      typeof settings.contactDetails === 'object' &&
      !Array.isArray(settings.contactDetails)
        ? (settings.contactDetails as ContactDetails)
        : SOFTILO_DEFAULT_BRANDING.contactDetails;

    return {
      displayName: settings.name || SOFTILO_DEFAULT_BRANDING.displayName,
      logoUrl: settings.logoUrl ?? SOFTILO_DEFAULT_BRANDING.logoUrl,
      themeTokens: mergeWithDefaultTheme(settings.themeTokens),
      contactDetails: contact,
      timezone: settings.timezone,
      currency: settings.currency,
    };
  }

  async getPublicBranding(): Promise<PublicBrandingProjection> {
    if (this.brandingCache) {
      return this.brandingCache;
    }

    const settings = await this.prisma.studioSettings.findUnique({
      where: { id: DEFAULT_STUDIO_ID },
    });
    const projection = this.toPublicBrandingProjection(settings);
    this.brandingCache = projection;
    return projection;
  }

  async getStudioSettings() {
    const settings = await this.prisma.studioSettings.findUnique({
      where: { id: DEFAULT_STUDIO_ID },
    });
    const projection = this.toPublicBrandingProjection(settings);
    return {
      ...projection,
      advancePolicyType: settings?.advancePolicyType ?? AdvancePolicyType.PERCENTAGE,
      advancePolicyValue: toJsonPoisha(settings?.advancePolicyValue ?? 20n),
      operationalPolicies: settings?.operationalPolicies ?? null,
      updatedAt: settings?.updatedAt ?? new Date(0),
    };
  }

  async updateBranding(dto: UpdateBrandingDto) {
    if (dto.timezone !== undefined && !isValidIanaTimezone(dto.timezone)) {
      throw new BadRequestException(`Invalid IANA timezone: ${dto.timezone}`);
    }

    const validatedLogo =
      dto.logoUrl !== undefined ? validateLogoUrl(dto.logoUrl) : undefined;
    const validatedTheme =
      dto.themeTokens !== undefined ? validateThemeTokens(dto.themeTokens) : undefined;

    if (
      dto.advancePolicyType === AdvancePolicyType.PERCENTAGE &&
      dto.advancePolicyValue !== undefined &&
      (dto.advancePolicyValue < 0 || dto.advancePolicyValue > 100)
    ) {
      throw new BadRequestException('Percentage advance policy must be between 0 and 100');
    }

    const existing = await this.prisma.studioSettings.findUnique({
      where: { id: DEFAULT_STUDIO_ID },
    });

    const mergedTheme =
      validatedTheme !== undefined
        ? {
            ...mergeWithDefaultTheme(existing?.themeTokens),
            ...validatedTheme,
          }
        : undefined;

    const updated = await this.prisma.studioSettings.upsert({
      where: { id: DEFAULT_STUDIO_ID },
      create: {
        id: DEFAULT_STUDIO_ID,
        name: dto.name?.trim() || SOFTILO_DEFAULT_BRANDING.displayName,
        logoUrl: validatedLogo ?? null,
        themeTokens: (mergedTheme ??
          SOFTILO_DEFAULT_BRANDING.themeTokens) as unknown as Prisma.InputJsonValue,
        contactDetails: (dto.contactDetails ?? {}) as Prisma.InputJsonValue,
        timezone: dto.timezone || 'Asia/Dhaka',
        currency: dto.currency?.trim().toUpperCase() || 'BDT',
        advancePolicyType: dto.advancePolicyType ?? AdvancePolicyType.PERCENTAGE,
        advancePolicyValue: toPoisha(dto.advancePolicyValue ?? 20),
      },
      update: {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        logoUrl: validatedLogo,
        themeTokens: mergedTheme as unknown as Prisma.InputJsonValue | undefined,
        contactDetails: dto.contactDetails as Prisma.InputJsonValue | undefined,
        timezone: dto.timezone,
        currency: dto.currency?.trim().toUpperCase(),
        advancePolicyType: dto.advancePolicyType,
        advancePolicyValue:
          dto.advancePolicyValue !== undefined
            ? toPoisha(dto.advancePolicyValue)
            : undefined,
      },
    });

    this.clearBrandingCache();

    return {
      ...this.toPublicBrandingProjection(updated),
      advancePolicyType: updated.advancePolicyType,
      advancePolicyValue: toJsonPoisha(updated.advancePolicyValue),
      operationalPolicies: updated.operationalPolicies,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Idempotently initializes the single studio configuration, default preset catalog,
   * and owner account without overwriting existing edits on retry.
   */
  async initializeStudio(options: InitializeStudioOptions) {
    const ownerEmail = options.ownerEmail.trim().toLowerCase();
    const timezone = options.timezone || 'Asia/Dhaka';
    if (!isValidIanaTimezone(timezone)) {
      throw new BadRequestException(`Invalid IANA timezone: ${timezone}`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let settings = await tx.studioSettings.findUnique({
        where: { id: DEFAULT_STUDIO_ID },
      });
      const createdSettings = !settings;

      if (!settings) {
        settings = await tx.studioSettings.create({
          data: {
            id: DEFAULT_STUDIO_ID,
            name: options.name?.trim() || SOFTILO_DEFAULT_BRANDING.displayName,
            themeTokens: SOFTILO_DEFAULT_BRANDING.themeTokens as unknown as Prisma.InputJsonValue,
            contactDetails: {} as Prisma.InputJsonValue,
            timezone,
            currency: options.currency?.trim().toUpperCase() || 'BDT',
            advancePolicyType: AdvancePolicyType.PERCENTAGE,
            advancePolicyValue: 20n,
          },
        });
      }

      let owner = await tx.user.findUnique({ where: { email: ownerEmail } });
      if (!owner) {
        owner = await tx.user.create({
          data: {
            email: ownerEmail,
            name: options.ownerName.trim(),
            passwordHash: hashPassword(options.ownerPassword),
            role: UserRole.OWNER,
            isActive: true,
          },
        });
      } else if (owner.role !== UserRole.OWNER || !owner.isActive) {
        owner = await tx.user.update({
          where: { id: owner.id },
          data: { role: UserRole.OWNER, isActive: true },
        });
      }

      const existingEventTypes = await tx.eventType.count();
      if (existingEventTypes === 0) {
        if (options.preset === 'wedding-photography') {
          await this.seedWeddingPhotographyPreset(tx);
        } else {
          await this.seedNeutralCorporateDefaults(tx);
        }
      }

      return {
        createdSettings,
        studio: this.toPublicBrandingProjection(settings),
        owner: {
          id: owner.id,
          email: owner.email,
          name: owner.name,
          role: owner.role,
          isActive: owner.isActive,
        },
      };
    });

    this.clearBrandingCache();
    return result;
  }

  private async seedWeddingPhotographyPreset(tx: Prisma.TransactionClient): Promise<void> {
    const weddingType = await tx.eventType.create({
      data: {
        name: 'Wedding',
        slug: 'wedding',
        description: 'Full wedding day photography and cinematography coverage',
      },
    });

    const holudType = await tx.eventType.create({
      data: {
        name: 'Holud / Mehndi',
        slug: 'holud-mehndi',
        description: 'Pre-wedding cultural celebration coverage',
      },
    });
    const receptionType = await tx.eventType.create({
      data: {
        name: 'Reception',
        slug: 'reception',
        description: 'Evening reception photography and film',
      },
    });
    const corporateType = await tx.eventType.create({
      data: {
        name: 'Corporate Event',
        slug: 'corporate-event',
        description: 'Conferences, summits, and corporate gatherings',
      },
    });

    const photoService = await tx.serviceItem.create({
      data: {
        name: 'Lead Photographer',
        unitLabel: 'day',
        defaultUnitPricePoisha: 2500000n,
      },
    });
    const filmService = await tx.serviceItem.create({
      data: {
        name: 'Cinematographer',
        unitLabel: 'day',
        defaultUnitPricePoisha: 2000000n,
      },
    });
    const albumService = await tx.serviceItem.create({
      data: {
        name: 'Printed Story Album',
        unitLabel: 'album',
        defaultUnitPricePoisha: 500000n,
      },
    });

    await tx.package.create({
      data: {
        eventTypeId: weddingType.id,
        name: 'Signature Wedding Collection',
        slug: 'signature-wedding-collection',
        description: 'Photography, cinematography, and story album',
        basePricePoisha: 5000000n,
        isPublished: true,
        items: {
          create: [
            {
              serviceItemId: photoService.id,
              description: 'Lead Photographer (Full Day)',
              quantity: 1,
              unitPricePoisha: 2500000n,
            },
            {
              serviceItemId: filmService.id,
              description: 'Cinematographer (Full Day)',
              quantity: 1,
              unitPricePoisha: 2000000n,
            },
            {
              serviceItemId: albumService.id,
              description: 'Printed Story Album (40 Pages)',
              quantity: 1,
              unitPricePoisha: 500000n,
            },
          ],
        },
      },
    });

    await tx.package.create({
      data: {
        eventTypeId: holudType.id,
        name: 'Holud & Mehndi Vivid Coverage',
        slug: 'holud-mehndi-vivid-coverage',
        description: 'Candid & stage photography plus same-night teaser selects',
        basePricePoisha: 3000000n,
        isPublished: true,
        items: {
          create: [
            {
              serviceItemId: photoService.id,
              description: 'Lead & Candid Photography (Evening)',
              quantity: 1,
              unitPricePoisha: 1800000n,
            },
            {
              serviceItemId: filmService.id,
              description: 'Holud Cinematography & Highlight Reel',
              quantity: 1,
              unitPricePoisha: 1200000n,
            },
          ],
        },
      },
    });

    await tx.package.create({
      data: {
        eventTypeId: corporateType.id,
        name: 'Corporate Summit Coverage',
        slug: 'corporate-summit-coverage',
        description: 'Keynote, panel, and networking documentation with fast press gallery',
        basePricePoisha: 3500000n,
        isPublished: true,
        items: {
          create: [
            {
              serviceItemId: photoService.id,
              description: 'Corporate Event Photographer (Full Day)',
              quantity: 1,
              unitPricePoisha: 2000000n,
            },
            {
              serviceItemId: filmService.id,
              description: 'Aftermovie & Speaker Highlights',
              quantity: 1,
              unitPricePoisha: 1500000n,
            },
          ],
        },
      },
    });

    await tx.deliverableLabel.createMany({
      data: [
        { eventTypeId: weddingType.id, label: 'Gallery', defaultDueDays: 14 },
        { eventTypeId: weddingType.id, label: 'Film', defaultDueDays: 30 },
        { eventTypeId: weddingType.id, label: 'Album', defaultDueDays: 45 },
        { eventTypeId: holudType.id, label: 'Holud Gallery', defaultDueDays: 7 },
        { eventTypeId: holudType.id, label: 'Holud Teaser Reel', defaultDueDays: 14 },
        { eventTypeId: receptionType.id, label: 'Reception Gallery', defaultDueDays: 14 },
        { eventTypeId: receptionType.id, label: 'Reception Highlight Film', defaultDueDays: 30 },
        { eventTypeId: corporateType.id, label: 'Event Summary', defaultDueDays: 5 },
      ],
    });

    await tx.taskTemplate.createMany({
      data: [
        {
          eventTypeId: weddingType.id,
          title: 'Pre-event timeline review',
          roleLabel: 'Coordinator',
          defaultOffsetDays: -3,
        },
        {
          eventTypeId: weddingType.id,
          title: 'Event coverage',
          roleLabel: 'Lead Photographer',
          defaultOffsetDays: 0,
        },
        {
          eventTypeId: weddingType.id,
          title: 'RAW backup & photo culling',
          roleLabel: 'Editor',
          defaultOffsetDays: 2,
        },
        {
          eventTypeId: holudType.id,
          title: 'Venue lighting & stage check',
          roleLabel: 'Coordinator',
          defaultOffsetDays: -1,
        },
        {
          eventTypeId: holudType.id,
          title: 'Holud evening coverage',
          roleLabel: 'Lead Photographer',
          defaultOffsetDays: 0,
        },
        {
          eventTypeId: receptionType.id,
          title: 'Reception shot-list confirmation',
          roleLabel: 'Coordinator',
          defaultOffsetDays: -2,
        },
        {
          eventTypeId: corporateType.id,
          title: 'AV & schedule run-through',
          roleLabel: 'Coordinator',
          defaultOffsetDays: -1,
        },
      ],
    });
  }

  private async seedNeutralCorporateDefaults(tx: Prisma.TransactionClient): Promise<void> {
    const corpType = await tx.eventType.create({
      data: {
        name: 'Corporate Event',
        slug: 'corporate-event',
        description: 'Conferences, summits, and corporate gatherings',
      },
    });

    await tx.deliverableLabel.create({
      data: {
        eventTypeId: corpType.id,
        label: 'Event Summary',
        defaultDueDays: 7,
      },
    });
  }

  async addMember(dto: AddMemberDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (!existing) {
      if (!dto.password) {
        throw new BadRequestException('password is required when creating a new user');
      }
      const created = await this.prisma.user.create({
        data: {
          email,
          name: dto.name.trim(),
          passwordHash: hashPassword(dto.password),
          role: dto.role,
          isActive: dto.isActive ?? true,
        },
        select: { id: true, email: true, name: true, role: true, isActive: true },
      });
      return created;
    }

    const updated = await this.prisma.user.update({
      where: { id: existing.id },
      data: {
        name: dto.name.trim(),
        role: dto.role,
        isActive: dto.isActive ?? true,
      },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    return updated;
  }

  async listMembers() {
    return this.prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
