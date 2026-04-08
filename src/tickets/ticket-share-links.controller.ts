import { Controller, Get, Post, Delete, Param, UseGuards } from '@nestjs/common';
import { TicketShareLinksService } from './ticket-share-links.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';

@UseGuards(JwtAccessGuard)
@Controller('projects/:projectId/ticket-share-links')
export class TicketShareLinksController {
  constructor(private readonly shareLinksService: TicketShareLinksService) {}

  @Post()
  create(@Param('projectId') projectId: string, @CurrentUser() user: AccessTokenPayload) {
    return this.shareLinksService.create(projectId, user);
  }

  @Get()
  list(@Param('projectId') projectId: string, @CurrentUser() user: AccessTokenPayload) {
    return this.shareLinksService.list(projectId, user);
  }

  @Post(':id/refresh')
  refresh(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.shareLinksService.refresh(projectId, id, user);
  }

  @Delete(':id')
  revoke(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.shareLinksService.revoke(projectId, id, user);
  }
}
