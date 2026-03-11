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
import { CreateNotificationDto } from './dto/create-notification.dto';
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
