import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Delete,
  Query,
  UseGuards,
  Put,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { Throttle, minutes } from '@nestjs/throttler';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { ListIssuesDto, ListPullsDto } from 'src/github/dto/list.dto';
import { JwtAccessGuard } from 'src/auth/guards/jwt-access.guard';
import { IsEnum } from 'class-validator';
import { ProjectMemberRole } from '@prisma/client';
import { UpdateDocumentationLabelPreferencesDto } from './dto/update-documentation-label-preferences.dto';
import { CreateManualShareLinkDto } from './dto/create-manual-share-link.dto';

class UpdateMemberRoleDto {
  @IsEnum(ProjectMemberRole)
  role!: ProjectMemberRole
}
class UpsertProjectGithubCredentialDto {
  accessToken!: string; // ⚠️ en producción: cifra en reposo
  refreshToken?: string;
  tokenType?: string;
  scopes?: string;
  expiresAt?: Date;
}
@UseGuards(JwtAccessGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  // Crea proyecto: el owner = usuario actual; se auto-agrega como OWNER en members
  @Post()
  async create(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreateProjectDto) {
    return this.service.create(user, dto);
  }

  // Proyectos donde soy owner o miembro
  @Get('mine')
  async mine(@CurrentUser() user: AccessTokenPayload, @Query() query: PaginationDto) {
    return this.service.findMine(user, query);
  }

  // Proyectos borrados (soft delete) donde soy owner o miembro
  @Get('deleted')
  async deleted(@CurrentUser() user: AccessTokenPayload, @Query() query: PaginationDto) {
    return this.service.listDeleted(user, query);
  }
  // Ver detalle (owner, miembro o público)
  @Get(':id')
  async getOne(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.findOne(user, id);
  }

  // Solo owner puede actualizar
  @Patch(':id')
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.service.update(user, id, dto);
  }

  // Solo owner puede borrar
  @Delete(':id')
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.remove(user, id);
  }

  @Patch(':id/restore')
  async restore(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.restore(user, id);
  }

  @Get(':id/structure')
  async structure(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.getStructure(user, id);
  }

  @Get(':id/documentation/labels')
  async listDocumentationLabels(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.listVisibleDocumentationLabelsForUser(user, id);
  }

  @Get(':id/documentation/label-preferences')
  async getDocumentationLabelPreferences(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.getDocumentationLabelPreferences(user, id);
  }

  @Put(':id/documentation/label-preferences')
  async updateDocumentationLabelPreferences(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDocumentationLabelPreferencesDto,
  ) {
    return this.service.updateDocumentationLabelPreferences(user, id, dto.labelIds);
  }

  @Post(':id/manual/share-links')
  async createManualShareLink(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateManualShareLinkDto,
  ) {
    return this.service.createManualShareLink(user, id, dto.labelIds);
  }

  @Get(':id/manual/share-links')
  async listManualShareLinks(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.listManualShareLinks(user, id);
  }

  @Delete(':id/manual/share-links/:linkId')
  async revokeManualShareLink(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('linkId', new ParseUUIDPipe()) linkId: string,
  ) {
    return this.service.revokeManualShareLink(user, id, linkId);
  }

  // Gestión de miembros — solo owner
  @Post(':id/members')
  @Throttle({ default: { limit: 30, ttl: minutes(1) } })
  async addMember(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.service.addMember(user, id, dto.userId, dto.role);
  }
  @Patch(':id/members/:userId')
  async updateMemberRole(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId') memberUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.service.updateMemberRole(user, id, memberUserId, dto.role);
  }
  @Delete(':id/members/:userId')
  async removeMember(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId') memberUserId: string,
  ) {
    return this.service.removeMember(user, id, memberUserId);
  }
  @Get(':id/members')
  async listMembers(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const project = await this.service.findOne(user, id);
    return project!.members;
  }

  // Issues del repo vinculado
  @Get(':id/github/issues')
  @Throttle({ default: { limit: 60, ttl: minutes(1) } })
  async listIssues(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: ListIssuesDto,
  ) {
    const items = await this.service.listProjectIssues(user, id, q);
    return { items };
  }
  // Pull Requests del repo vinculado
  @Get(':id/github/pulls')
  @Throttle({ default: { limit: 60, ttl: minutes(1) } })
  async listPulls(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: ListPullsDto,
  ) {
    const items = await this.service.listProjectPulls(user, id, q);
    return { items };
  }

  // Credential GitHub a nivel de proyecto — solo owner
  @Post(':id/github/credential')
  async upsertProjectGithubCredential(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpsertProjectGithubCredentialDto,
  ) {
    return this.service.upsertProjectGithubCredential(user, id, dto);
  }

  @Delete(':id/github/credential')
  async deleteProjectGithubCredential(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.deleteProjectGithubCredential(user, id);
  }
}