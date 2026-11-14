import 'dotenv/config';
import { StudioService } from '../modules/studio/studio.service.js';
import { PrismaService } from './prisma.service.js';
import { seedDefaultAdmin } from './seed-admin.js';

async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();

  try {
    const studioService = new StudioService(prisma);
    const summary = await seedDefaultAdmin(studioService);
    console.log(
      `[seed] Ready: studio="${summary.studioName}" (${summary.createdSettings ? 'created' : 'existing'}), owner="${summary.adminEmail}", role=${summary.role}`,
    );
  } finally {
    await prisma.onModuleDestroy();
  }
}

await main();
