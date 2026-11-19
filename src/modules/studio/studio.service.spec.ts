import { ConflictException } from '@nestjs/common';
import { AdvancePolicyType, ResourceType, UserRole } from '../../generated/prisma/client.js';
import { SOFTILO_DEFAULT_BRANDING } from '../../common/branding/branding-defaults.js';
import { StudioService } from './studio.service.js';

describe('StudioService (Single-tenant branding & cache)', () => {
  it('returns neutral Softilo defaults when settings are missing and invalidates cache on branding update', async () => {
    let storedSettings: {
      id: string;
      name: string;
      logoUrl: string | null;
      themeTokens: unknown;
      contactDetails: unknown;
      timezone: string;
      currency: string;
      advancePolicyType: AdvancePolicyType;
      advancePolicyValue: bigint;
      operationalPolicies: unknown;
      createdAt: Date;
      updatedAt: Date;
    } | null = null;

    const findUnique = vi.fn(async () => storedSettings);
    const upsert = vi.fn(async ({ create, update }: { create: { name: string }; update: { name?: string } }) => {
      if (!storedSettings) {
        storedSettings = {
          id: 'default',
          name: create.name,
          logoUrl: null,
          themeTokens: SOFTILO_DEFAULT_BRANDING.themeTokens,
          contactDetails: {},
          timezone: 'Asia/Dhaka',
          currency: 'BDT',
          advancePolicyType: AdvancePolicyType.PERCENTAGE,
          advancePolicyValue: 20n,
          operationalPolicies: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      } else if (update.name) {
        storedSettings.name = update.name;
      }
      return storedSettings;
    });

    const prismaMock = {
      studioSettings: { findUnique, upsert },
    } as never;

    const service = new StudioService(prismaMock);

    const initial = await service.getPublicBranding();
    expect(initial.displayName).toBe(SOFTILO_DEFAULT_BRANDING.displayName);
    expect(initial.themeTokens).toEqual(SOFTILO_DEFAULT_BRANDING.themeTokens);

    // Second read should hit in-memory cache
    const cached = await service.getPublicBranding();
    expect(cached).toEqual(initial);
    expect(findUnique).toHaveBeenCalledTimes(1);

    // Updating branding clears cache
    await service.updateBranding({ name: 'Wedding PhotoArt Studio' });
    const updated = await service.getPublicBranding();
    expect(updated.displayName).toBe('Wedding PhotoArt Studio');
  });

  it('links a CREW resource on addMember when isBookableCrew is true and protects last active OWNER', async () => {
    const createdResources: Array<{ userId: string | null; type: ResourceType; name: string }> = [];
    const tx = {
      user: {
        create: vi.fn(async ({ data }: { data: { email: string; name: string; role: UserRole; isActive: boolean } }) => ({
          id: 'user-crew-1',
          email: data.email,
          name: data.name,
          role: data.role,
          isActive: data.isActive,
        })),
      },
      resource: {
        findMany: vi.fn(async () => createdResources.map((r, i) => ({ id: `res-${i}`, isActive: true, ...r }))),
        create: vi.fn(async ({ data }: { data: { userId: string; type: ResourceType; name: string } }) => {
          createdResources.push(data);
          return { id: 'res-1', isActive: true, ...data };
        }),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };

    const prismaMock = {
      user: {
        findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
          if (where.email) return null;
          if (where.id === 'owner-1') {
            return { id: 'owner-1', email: 'owner@test.bd', name: 'Owner', role: UserRole.OWNER, isActive: true };
          }
          return null;
        }),
        count: vi.fn(async () => 0),
      },
      $transaction: vi.fn(async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx)),
    } as never;

    const service = new StudioService(prismaMock);
    const added = await service.addMember({
      email: 'ariful@studio.bd',
      name: 'Ariful Islam',
      password: 'Password123!',
      role: UserRole.STAFF,
      isBookableCrew: true,
      crewTitle: 'Lead Photographer',
    });

    expect(added.id).toBe('user-crew-1');
    expect(createdResources).toHaveLength(1);
    expect(createdResources[0]).toEqual(
      expect.objectContaining({
        userId: 'user-crew-1',
        type: ResourceType.CREW,
        name: 'Ariful Islam (Lead Photographer)',
      }),
    );

    await expect(
      service.updateMember('owner-1', 'other-admin', { isActive: false }),
    ).rejects.toThrow(ConflictException);
  });
});
