import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AccessTokenPayload } from 'src/auth/types/jwt-payload';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { QaService } from './qa.service';
import { UpdateDocumentationEntryDto } from './dto/update-documentation-entry.dto';

@Controller('qa')
export class DocumentationController {
  constructor(private readonly qaService: QaService) {}

  @Get('features/:featureId/documentation')
  async listFeatureDocumentation(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('featureId', ParseUUIDPipe) featureId: string,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.listFeatureDocumentation(userId, featureId);
  }

  @Get('projects/:projectId/documentation')
  async listProjectDocumentation(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.listProjectDocumentation(userId, projectId);
  }

  @Put('features/:featureId/documentation/:labelId')
  async upsertFeatureDocumentation(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
    @Body() dto: UpdateDocumentationEntryDto,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.upsertFeatureDocumentation(userId, featureId, labelId, dto);
  }

  @Put('projects/:projectId/documentation/:labelId')
  async upsertProjectDocumentation(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
    @Body() dto: UpdateDocumentationEntryDto,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.upsertProjectDocumentation(userId, projectId, labelId, dto);
  }

  @Get('modules/:moduleId/documentation')
  async listModuleDocumentation( 
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('moduleId', ParseUUIDPipe) moduleId: string,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.listModuleDocumentation(userId, moduleId);
  }

  @Put('modules/:moduleId/documentation/:labelId')
  async upsertModuleDocumentation(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('moduleId', ParseUUIDPipe) moduleId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
    @Body() dto: UpdateDocumentationEntryDto,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.upsertModuleDocumentation(userId, moduleId, labelId, dto);
  }

  @Get(':entityType/:entityId/documentation/images')
  async listDocumentationImages(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Query('labelId') labelId?: string,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.listDocumentationImages(userId, entityType, entityId, labelId);
  }

  @UseInterceptors(FileInterceptor('file'))
  @Post(':entityType/:entityId/documentation/:labelId/images')
  async uploadDocumentationImage(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name?: string,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.uploadDocumentationImage(userId, entityType, entityId, labelId, file, name);
  }

  @Delete(':entityType/:entityId/documentation/images/:imageId')
  async deleteDocumentationImage(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.deleteDocumentationImage(userId, entityType, entityId, imageId);
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
