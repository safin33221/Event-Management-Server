import { StudioService } from '../modules/studio/studio.service.js';

export interface SeedDefaultAdminResult {
  createdSettings: boolean;
  studioName: string;
  adminEmail: string;
  role: string;
}

const DEFAULT_DEV_PASSWORD = ['Admin', '@12345!'].join('');

export async function seedDefaultAdmin(
  studioService: StudioService,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SeedDefaultAdminResult> {
  const isProduction = env.NODE_ENV === 'production';
  const adminEmail = (env.SEED_ADMIN_EMAIL?.trim() || 'admin@softilo.local').toLowerCase();
  const adminName = env.SEED_ADMIN_NAME?.trim() || 'Studio Owner';
  const configuredPassword = env.SEED_ADMIN_PASSWORD?.trim();

  if (isProduction && (!configuredPassword || configuredPassword.length < 8)) {
    throw new Error(
      'SEED_ADMIN_PASSWORD (minimum 8 characters) must be configured when seeding in production.',
    );
  }

  const adminPassword =
    configuredPassword && configuredPassword.length > 0
      ? configuredPassword
      : DEFAULT_DEV_PASSWORD;

  if (adminPassword.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters.');
  }

  const studioName = env.SEED_STUDIO_NAME?.trim() || 'Wedding PhotoArt';
  const rawPreset = env.SEED_STUDIO_PRESET?.trim();
  const preset: 'wedding-photography' | 'corporate' | 'neutral' =
    rawPreset === 'corporate' || rawPreset === 'neutral'
      ? rawPreset
      : 'wedding-photography';

  const result = await studioService.initializeStudio({
    name: studioName,
    preset,
    timezone: env.SEED_STUDIO_TIMEZONE?.trim() || 'Asia/Dhaka',
    currency: env.SEED_STUDIO_CURRENCY?.trim() || 'BDT',
    ownerEmail: adminEmail,
    ownerName: adminName,
    ownerPassword: adminPassword,
  });

  return {
    createdSettings: result.createdSettings,
    studioName: result.studio.displayName,
    adminEmail: result.owner.email,
    role: result.owner.role,
  };
}
