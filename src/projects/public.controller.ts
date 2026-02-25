import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Public } from 'src/auth/public.decorator';
import { ProjectsService } from './projects.service';

@Controller('public')
export class PublicController {
  constructor(private readonly service: ProjectsService) {}

  @Public()
  @Get('manual/:projectId')
  async manual(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query('labels') labels?: string,
  ) {
    return this.service.getPublicManual(projectId, labels);
  }

  @Public()
  @Get('manual/shared/:linkId')
  async sharedManual(
    @Param('linkId', new ParseUUIDPipe()) linkId: string,
    @Query('labels') labels?: string,
  ) {
    return this.service.getSharedManual(linkId, labels);
  }

  @Public()
  @Get('manual/shared/:linkId/images')
  async sharedManualImages(
    @Param('linkId', new ParseUUIDPipe()) linkId: string,
    @Query('labelId') labelId?: string,
  ) {
    return this.service.getSharedManualImages(linkId, labelId);
  }
}
