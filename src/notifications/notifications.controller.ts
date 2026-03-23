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
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import {
  CreateNotificationDto,
  CreateUserNotificationDto,
  CreateProjectNotificationDto,
  CreateBulkNotificationDto,
} from './dto/create-notification.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';

@UseGuards(JwtAccessGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  create(@Body() dto: CreateNotificationDto) {
    return this.notificationsService.create(dto);
  }

  @Post('user')
  createForUser(@Body() dto: CreateUserNotificationDto) {
    return this.notificationsService.createForUser(dto);
  }

  @Post('project/:projectId')
  createForProject(
    @Param('projectId') projectId: string,
    @Body() dto: CreateProjectNotificationDto,
  ) {
    return this.notificationsService.createForProject(dto, projectId);
  }

  @Post('all')
  createForAllUsers(@Body() dto: CreateBulkNotificationDto) {
    return this.notificationsService.createForAllUsers(dto);
  }

  @Get()
  findAll(@CurrentUser() user: AccessTokenPayload, @Query() pagination: PaginationDto) {
    return this.notificationsService.findAll(user.sub, pagination);
  }

  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: AccessTokenPayload) {
    return this.notificationsService.findUnreadCount(user.sub);
  }

  @Patch(':id/read')
  markAsRead(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.notificationsService.markAsRead(id, user.sub);
  }

  @Patch('read-all')
  markAllAsRead(@CurrentUser() user: AccessTokenPayload) {
    return this.notificationsService.markAllAsRead(user.sub);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.notificationsService.delete(id, user.sub);
  }
}
