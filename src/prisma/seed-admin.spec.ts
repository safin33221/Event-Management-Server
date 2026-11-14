import { describe, expect, it, vi } from 'vitest';
import { StudioService } from '../modules/studio/studio.service.js';
import { seedDefaultAdmin } from './seed-admin.js';

describe('seedDefaultAdmin', () => {
  it('initializes studio settings and default OWNER account without multi-tenant fields', async () => {
    const initializeStudio = vi.fn().mockResolvedValue({
      createdSettings: true,
      studio: { displayName: 'Wedding PhotoArt' },
      owner: { id: 'user-1', email: 'admin@softilo.local', name: 'Studio Owner', role: 'OWNER', isActive: true },
    });

    const studioService = { initializeStudio } as unknown as StudioService;

    const result = await seedDefaultAdmin(studioService, {});

    expect(initializeStudio).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Wedding PhotoArt',
        ownerEmail: 'admin@softilo.local',
        preset: 'wedding-photography',
      }),
    );
    expect(result).toEqual({
      createdSettings: true,
      studioName: 'Wedding PhotoArt',
      adminEmail: 'admin@softilo.local',
      role: 'OWNER',
    });
  });

  it('requires SEED_ADMIN_PASSWORD in production', async () => {
    const studioService = {} as StudioService;

    await expect(
      seedDefaultAdmin(studioService, { NODE_ENV: 'production' }),
    ).rejects.toThrow('SEED_ADMIN_PASSWORD');
  });
});
