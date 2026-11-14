import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/guards/auth.guard.js';
import { StudioService } from './studio.service.js';

@Public()
@Controller('public')
export class PublicBrandingController {
  constructor(private readonly studioService: StudioService) {}

  @Get('branding')
  getBranding() {
    return this.studioService.getPublicBranding();
  }
}
