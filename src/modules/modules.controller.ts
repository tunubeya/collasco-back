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
  UseGuards,
} from '@nestjs/common';
import { ModulesService } from './modules.service';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { SnapshotModuleDto } from './dto/snapshot-module.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { JwtAccessGuard } from 'src/auth/guards/jwt-access.guard';
import { IsInt, Min } from 'class-validator';
import { MoveOrderDto } from 'src/common/dto/move-order.dto';

class PublishModuleDto {
  @IsInt()
  @Min(1)
  versionNumber!: number;
}

@UseGuards(JwtAccessGuard)
@Controller()
export class ModulesController {
  constructor(private readonly service: ModulesService) {}

  // Crear módulo dentro de un proyecto
  @Post('projects/:projectId/modules')
  async createInProject(
    @CurrentUser() user: AccessTokenPayload,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: CreateModuleDto,
  ) {
    return this.service.createInProject(user, projectId, dto);
  }

  // Listar módulos del proyecto (opcional: ?parent=<uuid|null>)
  @Get('projects/:projectId/modules')
  async listInProject(
    @CurrentUser() user: AccessTokenPayload,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query('parent') parent?: string,
    @Query() query?: PaginationDto,
  ) {
    const parentParam = parent === undefined ? undefined : parent === 'null' ? null : parent;
    return this.service.listInProject(user, projectId, parentParam, query);
  }

  @Get('projects/:projectId/modules/deleted')
  async listDeletedInProject(
    @CurrentUser() user: AccessTokenPayload,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query('parent') parent?: string,
    @Query() query?: PaginationDto,
  ) {
    const parentParam = parent === undefined ? undefined : parent === 'null' ? null : parent;
    return this.service.listDeletedInProject(user, projectId, parentParam, query);
  }

  @Get('modules/:moduleId/structure')
  async getModuleStructure(@CurrentUser() user: AccessTokenPayload, @Param('moduleId') moduleId: string) {
    return this.service.getModuleStructure(user, moduleId);
  }

  // Detalle de un módulo (+ hijos, features, versiones)
  @Get('modules/:moduleId')
  async getOne(
    @CurrentUser() user: AccessTokenPayload,
    @Param('moduleId', new ParseUUIDPipe()) moduleId: string,
  ) {
    return this.service.getOne(user, moduleId);
  }

  // Actualizar módulo
  @Patch('modules/:moduleId')
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('moduleId', new ParseUUIDPipe()) moduleId: string,
    @Body() dto: UpdateModuleDto,
  ) {
    return this.service.update(user, moduleId, dto);
  }

  @Patch('modules/:moduleId/order')
  async moveOrder(
    @CurrentUser() user: AccessTokenPayload,
    @Param('moduleId', new ParseUUIDPipe()) moduleId: string,
    @Body() dto: MoveOrderDto,
  ) {
    return this.service.moveOrder(user, moduleId, dto.direction);
  }

  @Delete('modules/:moduleId')
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('moduleId', new ParseUUIDPipe()) moduleId: string,
    @Query('cascade') cascade?: string,
    @Query('force') force?: string,
  ) {
    const doCascade = cascade === 'true';
    const hardForce = force === 'true';
    return this.service.delete(user, moduleId, { cascade: doCascade, force: hardForce });
  }

  @Patch('modules/:moduleId/restore')
  async restore(
    @CurrentUser() user: AccessTokenPayload,
    @Param('moduleId', new ParseUUIDPipe()) moduleId: string,
  ) {
    return this.service.restore(user, moduleId);
  }
  // Crear snapshot de versión
  @Post('modules/:moduleId/snapshot')
  async snapshot(
    @CurrentUser() user: AccessTokenPayload,
    @Param('moduleId', new ParseUUIDPipe()) moduleId: string,
    @Body() dto: SnapshotModuleDto,
  ) {
    return this.service.snapshot(user, moduleId, dto.changelog);
  }

  // Rollback a versión X (crea snapshot si no existe, marcado rollback)
  @Post('modules/:moduleId/rollback/:versionNumber')
  async rollback(
    @CurrentUser() user: AccessTokenPayload,
    @Param('moduleId', new ParseUUIDPipe()) moduleId: string,
    @Param('versionNumber', ParseIntPipe) versionNumber: number,
    @Body() dto: SnapshotModuleDto,
  ) {
    return this.service.rollback(user, moduleId, versionNumber, dto.changelog);
  }

  // Publicar una versión (OWNER/MAINTAINER)
  @Post('modules/:moduleId/publish')
  async publish(
    @CurrentUser() user: AccessTokenPayload,
    @Param('moduleId', new ParseUUIDPipe()) moduleId: string,
    @Body() dto: PublishModuleDto,
  ) {
    return this.service.publish(user, moduleId, dto.versionNumber);
  }

  // Listar versiones
  @Get('modules/:moduleId/versions')
  async versions(
    @CurrentUser() user: AccessTokenPayload,
    @Param('moduleId', new ParseUUIDPipe()) moduleId: string,
  ) {
    return this.service.listVersions(user, moduleId);
  }

  // @Get('modules/:moduleId/published-tree')
  // async getPublishedTree(
  //   @CurrentUser() user: AccessTokenPayload,
  //   @Param('moduleId', new ParseUUIDPipe()) moduleId: string,
  // ) {
  //   return this.service.getPublishedTree(user, moduleId);
  // }

  // // Mover / reordenar módulo (cambiar parent y/o sortOrder)
  // @Patch('modules/:moduleId/move')
  // async move(
  //   @CurrentUser() user: AccessTokenPayload,
  //   @Param('moduleId', new ParseUUIDPipe()) moduleId: string,
  //   @Body() dto: MoveModuleDto,
  // ) {
  //   return this.service.move(user, moduleId, dto);
  // }
}