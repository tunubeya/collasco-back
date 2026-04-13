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
import { TicketNotificationService } from './ticket-notification.service';
import {
  CreateTicketDto,
  UpdateTicketDto,
  CreateTicketSectionDto,
  UpdateTicketSectionDto,
  ListTicketsQueryDto,
} from './dto/ticket.dto';
import {
  BulkAddTicketsNotifyDto,
  BulkAddTicketsEmailDto,
} from './dto/ticket-notification-prefs.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';
import { FileInterceptor } from '@nestjs/platform-express';

@UseGuards(JwtAccessGuard)
@Controller()
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly ticketNotificationService: TicketNotificationService,
  ) {}

  @Post('projects/:projectId/tickets')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateTicketDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.ticketsService.create(projectId, dto, user);
  }

  @Get('tickets')
  list(@Query() query: ListTicketsQueryDto, @CurrentUser() user: AccessTokenPayload) {
    return this.ticketsService.list(query, user);
  }

  @Get('projects/:projectId/tickets/autocomplete')
  searchFeatures(
    @Param('projectId') projectId: string,
    @Query('q') query: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.ticketsService.searchFeaturesForAutocomplete(projectId, query || '', user);
  }

  @Get('tickets/:id')
  findById(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.ticketsService.findById(id, user);
  }

  @Post('tickets/:id/open')
  openTicket(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.ticketsService.openTicket(id, user);
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

  // Notificaciones de tickets

  @Post('users/me/ticket-notify-tickets')
  bulkAddNotifyTickets(
    @Body() dto: BulkAddTicketsNotifyDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    console.log(
      `[bulkAddNotifyTickets] userId=${user.sub}, ticketIds=${JSON.stringify(dto.ticketIds)}`,
    );
    return this.ticketNotificationService.bulkAddTicketsNotify(user.sub, dto.ticketIds);
  }

  @Delete('users/me/ticket-notify-tickets/:ticketId')
  removeNotifyTicket(@Param('ticketId') ticketId: string, @CurrentUser() user: AccessTokenPayload) {
    console.log(`[removeNotifyTicket] userId=${user.sub}, ticketId=${ticketId}`);
    return this.ticketNotificationService.removeUserFromTicketNotify(user.sub, ticketId);
  }

  @Post('users/me/ticket-email-tickets')
  bulkAddEmailTickets(
    @Body() dto: BulkAddTicketsEmailDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    console.log(
      `[bulkAddEmailTickets] userId=${user.sub}, ticketIds=${JSON.stringify(dto.ticketIds)}`,
    );
    return this.ticketNotificationService.bulkAddTicketsEmail(user.sub, dto.ticketIds);
  }

  @Delete('users/me/ticket-email-tickets/:ticketId')
  removeEmailTicket(@Param('ticketId') ticketId: string, @CurrentUser() user: AccessTokenPayload) {
    console.log(`[removeEmailTicket] userId=${user.sub}, ticketId=${ticketId}`);
    return this.ticketNotificationService.removeUserFromTicketEmail(user.sub, ticketId);
  }
}
