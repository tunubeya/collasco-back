import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { QaService } from './qa.service';
import type { AccessTokenPayload } from 'src/auth/types/jwt-payload';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { CreateProjectLabelDto } from './dto/create-project-label.dto';
import { UpdateProjectLabelDto } from './dto/update-project-label.dto';
import { UpdateProjectLabelOrderDto } from './dto/update-project-label-order.dto';

@Controller('qa/projects/:projectId/labels')
export class ProjectLabelsController {
  constructor(private readonly qaService: QaService) {}

  @Get()
  async list(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.listProjectLabels(userId, projectId);
  }

  @Post()
  async create(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateProjectLabelDto,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.createProjectLabel(userId, projectId, dto);
  }

  @Patch(':labelId')
  async update(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
    @Body() dto: UpdateProjectLabelDto,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.updateProjectLabel(userId, projectId, labelId, dto);
  }

  @Delete(':labelId')
  async remove(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
  ) {
    const userId = this.resolveUserId(user);
    await this.qaService.deleteProjectLabel(userId, projectId, labelId);
    return { success: true };
  }

  @Patch(':labelId/order')
  async reorder(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
    @Body() dto: UpdateProjectLabelOrderDto,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.reorderProjectLabel(userId, projectId, labelId, dto.newIndex);
  }

  private resolveUserId(user: AccessTokenPayload | undefined): string {
    if (user?.sub) {
      return user.sub;
    }
    if ((user as unknown as { id?: string })?.id) {
      return (user as unknown as { id: string }).id;
    }
    return 'stub-user-id';
  }
}
