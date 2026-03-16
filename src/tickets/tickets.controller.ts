import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';
import {
  CreateTicketDto,
  UpdateTicketDto,
  CreateTicketSectionDto,
  UpdateTicketSectionDto,
} from './dto/ticket.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';
import { FileInterceptor } from '@nestjs/platform-express';

@UseGuards(JwtAccessGuard)
@Controller()
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post('projects/:projectId/tickets')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateTicketDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.ticketsService.create(projectId, dto, user);
  }

  @Get('projects/:projectId/tickets')
  findAll(
    @Param('projectId') projectId: string,
    @Query() pagination: PaginationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.ticketsService.findAll(projectId, pagination, user);
  }

  @Get('projects/:projectId/tickets/autocomplete')
  searchFeatures(
    @Param('projectId') projectId: string,
    @Query('q') query: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.ticketsService.searchFeaturesForAutocomplete(projectId, query || '', user);
  }

  @Get('tickets/mine')
  findMyTickets(@Query() pagination: PaginationDto, @CurrentUser() user: AccessTokenPayload) {
    return this.ticketsService.findMyTickets(pagination, user);
  }

  @Get('tickets/assigned')
  findAssignedTickets(@Query() pagination: PaginationDto, @CurrentUser() user: AccessTokenPayload) {
    return this.ticketsService.findAssignedTickets(pagination, user);
  }

  @Get('tickets/:id')
  findById(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.ticketsService.findById(id, user);
  }

  @Patch('tickets/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.ticketsService.update(id, dto, user);
  }

  @Post('tickets/:id/sections')
  addSection(
    @Param('id') id: string,
    @Body() dto: CreateTicketSectionDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.ticketsService.addSection(id, dto, user);
  }

  @Patch('tickets/:ticketId/sections/:sectionId')
  updateSection(
    @Param('ticketId') ticketId: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: UpdateTicketSectionDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.ticketsService.updateSection(ticketId, sectionId, dto, user);
  }

  @Get('features/:featureId/tickets')
  findByFeature(
    @Param('featureId') featureId: string,
    @Query() pagination: PaginationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.ticketsService.findByFeature(featureId, user, pagination);
  }

  @Post('tickets/:id/images')
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.ticketsService.uploadImage(id, file, name, user);
  }

  @Get('tickets/:id/images')
  getImages(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.ticketsService.getImages(id, user);
  }

  @Delete('tickets/:ticketId/images/:imageId')
  deleteImage(
    @Param('ticketId') ticketId: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.ticketsService.deleteImage(ticketId, imageId, user);
  }

  @Delete('tickets/:id')
  delete(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.ticketsService.delete(id, user);
  }
}
