import { Module } from '@nestjs/common';
import { PublicBrandingController } from './public-branding.controller.js';
import { StudioController } from './studio.controller.js';
import { StudioService } from './studio.service.js';

@Module({
  controllers: [StudioController, PublicBrandingController],
  providers: [StudioService],
  exports: [StudioService],
})
export class StudioModule {}
