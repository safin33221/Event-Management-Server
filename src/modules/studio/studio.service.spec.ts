import { AdvancePolicyType } from '../../generated/prisma/client.js';
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
});
