import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../../common/guards/auth.guard.js';
import { AddMemberDto } from './dto/add-member.dto.js';
import { UpdateBrandingDto } from './dto/update-branding.dto.js';
import { StudioService } from './studio.service.js';

@Controller('studio')
export class StudioController {
  constructor(private readonly studioService: StudioService) {}

  @Roles(UserRole.OWNER, UserRole.COORDINATOR, UserRole.ACCOUNTANT)
  @Get('settings')
  getSettings() {
    return this.studioService.getStudioSettings();
  }

  @Roles(UserRole.OWNER)
  @Patch('branding')
  updateBranding(@Body() dto: UpdateBrandingDto) {
    return this.studioService.updateBranding(dto);
  }

  @Roles(UserRole.OWNER)
  @Post('members')
  addMember(@Body() dto: AddMemberDto) {
    return this.studioService.addMember(dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Get('members')
  listMembers() {
    return this.studioService.listMembers();
  }
}
