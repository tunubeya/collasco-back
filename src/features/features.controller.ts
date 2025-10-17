import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { FeaturesService } from './features.service';
import { CreateFeatureDto } from './dto/create-feature.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';
import { SnapshotFeatureDto } from './dto/snapshot-feature.dto';
import { LinkIssueElementDto } from './dto/link-IssueElement.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { Throttle, minutes } from '@nestjs/throttler';
import { SyncCommitsDto } from './dto/sync-commits.dto';

@Controller()
export class FeaturesController {
  constructor(private readonly service: FeaturesService) {}

  // Crear feature dentro de un módulo
  @Post('modules/:moduleId/features')
  async createInModule(
    @CurrentUser() user: AccessTokenPayload,
    @Param('moduleId', new ParseUUIDPipe()) moduleId: string,
    @Body() dto: CreateFeatureDto,
  ) {
    return this.service.createInModule(user, moduleId, dto);
  }

  // Listar features de un módulo
  @Get('modules/:moduleId/features')
  async listInModule(
    @CurrentUser() user: AccessTokenPayload,
    @Param('moduleId', new ParseUUIDPipe()) moduleId: string,
    @Query() query: PaginationDto,
  ) {
    return this.service.listInModule(user, moduleId, query);
  }

  // Detalle de feature (con versiones + IssueElement)
  @Get('features/:featureId')
  async getOne(
    @CurrentUser() user: AccessTokenPayload,
    @Param('featureId', new ParseUUIDPipe()) featureId: string,
  ) {
    return this.service.getOne(user, featureId);
  }

  // Actualizar feature
  @Patch('features/:featureId')
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('featureId', new ParseUUIDPipe()) featureId: string,
    @Body() dto: UpdateFeatureDto,
  ) {
    return this.service.update(user, featureId, dto);
  }

  @Delete('features/:featureId')
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('featureId', new ParseUUIDPipe()) featureId: string,
    @Query('force') force?: string,
  ) {
    const hardForce = force === 'true';
    return this.service.delete(user, featureId, { force: hardForce });
  }

  // Listar versiones
  @Get('features/:featureId/versions')
  async versions(
    @CurrentUser() user: AccessTokenPayload,
    @Param('featureId', new ParseUUIDPipe()) featureId: string,
  ) {
    return this.service.listVersions(user, featureId);
  }

  // Versionado: snapshot (dedupe por contentHash)
  @Post('features/:featureId/snapshot')
  async snapshot(
    @CurrentUser() user: AccessTokenPayload,
    @Param('featureId', new ParseUUIDPipe()) featureId: string,
    @Body() dto: SnapshotFeatureDto,
  ) {
    return this.service.snapshot(user, featureId, dto.changelog);
  }

  // Versionado: rollback a versión X (crea snapshot rollback si aplica)
  @Post('features/:featureId/rollback/:versionNumber')
  async rollback(
    @CurrentUser() user: AccessTokenPayload,
    @Param('featureId', new ParseUUIDPipe()) featureId: string,
    @Param('versionNumber', ParseIntPipe) versionNumber: number,
    @Body() dto: SnapshotFeatureDto,
  ) {
    return this.service.rollback(user, featureId, versionNumber, dto.changelog);
  }

  // Publicar versión
  @Post('features/:featureId/publish/:versionNumber')
  async publish(
    @CurrentUser() user: AccessTokenPayload,
    @Param('featureId', new ParseUUIDPipe()) featureId: string,
    @Param('versionNumber', ParseIntPipe) versionNumber: number,
  ) {
    return this.service.publish(user, featureId, versionNumber);
  }

  // Issue: link / update / unlink
  @Post('features/:featureId/issue')
  async linkIssue(
    @CurrentUser() user: AccessTokenPayload,
    @Param('featureId', new ParseUUIDPipe()) featureId: string,
    @Body() dto: LinkIssueElementDto,
  ) {
    return this.service.linkIssue(user, featureId, dto);
  }

  @Patch('issue/:issueId')
  async updateIssue(
    @CurrentUser() user: AccessTokenPayload,
    @Param('issueId', new ParseUUIDPipe()) issueId: string,
    @Body() dto: LinkIssueElementDto,
  ) {
    return this.service.updateIssue(user, issueId, dto);
  }

  @Delete('issue/:issueId')
  async unlinkIssue(
    @CurrentUser() user: AccessTokenPayload,
    @Param('issueId', new ParseUUIDPipe()) issueId: string,
  ) {
    return this.service.unlinkIssue(user, issueId);
  }

  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
  @Post('issue/:issueId/sync')
  async syncIssue(
    @CurrentUser() user: AccessTokenPayload,
    @Param('issueId', new ParseUUIDPipe()) issueId: string,
  ) {
    return this.service.syncIssueFromGithub(user, issueId);
  }

  @Post('issue/:issueId/sync-commits')
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
  async syncIssueCommits(
    @CurrentUser() user: AccessTokenPayload,
    @Param('issueId', new ParseUUIDPipe()) issueId: string,
    @Body() dto: SyncCommitsDto,
  ) {
    return this.service.syncIssueCommits(user, issueId, dto);
  }
}
