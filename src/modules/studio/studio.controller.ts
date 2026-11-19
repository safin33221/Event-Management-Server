import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { CurrentActor, Roles } from '../../common/guards/auth.guard.js';
import type { RequestActor } from '../../common/guards/auth.guard.js';
import { AddMemberDto, UpdateMemberDto } from './dto/add-member.dto.js';
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

  @Roles(UserRole.OWNER)
  @Patch('members/:id')
  updateMember(
    @CurrentActor() actor: RequestActor,
    @Param('id') id: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.studioService.updateMember(id, actor.userId, dto);
  }

  @Roles(UserRole.OWNER, UserRole.COORDINATOR)
  @Get('members')
  listMembers() {
    return this.studioService.listMembers();
  }
}
