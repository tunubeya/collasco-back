import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
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
