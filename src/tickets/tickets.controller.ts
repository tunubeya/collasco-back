import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { CreateTicketDto, UpdateTicketDto, CreateTicketSectionDto } from './dto/ticket.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';

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

  @Get('features/:featureId/tickets')
  findByFeature(
    @Param('featureId') featureId: string,
    @Query() pagination: PaginationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.ticketsService.findByFeature(featureId, user, pagination);
  }

  @Get('tickets/mine')
  findMyTickets(@Query() pagination: PaginationDto, @CurrentUser() user: AccessTokenPayload) {
    return this.ticketsService.findMyTickets(pagination, user);
  }

  @Get('tickets/assigned')
  findAssignedTickets(@Query() pagination: PaginationDto, @CurrentUser() user: AccessTokenPayload) {
    return this.ticketsService.findAssignedTickets(pagination, user);
  }
}
