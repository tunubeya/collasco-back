import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateNotificationDto,
  CreateUserNotificationDto,
  CreateProjectNotificationDto,
  CreateBulkNotificationDto,
} from './dto/create-notification.dto';
import { PaginationDto } from '../common/dto/pagination.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateNotificationDto) {
    return this.prisma.notification.create({
      data: {
        userId: dto.userId!,
        title: dto.title,
        message: dto.message,
        type: dto.type || 'INFO',
        data: dto.data as Prisma.JsonObject | undefined,
      },
    });
  }

  async createForUser(dto: CreateUserNotificationDto) {
    return this.prisma.notification.create({
      data: {
        userId: dto.userId,
        title: dto.title,
        message: dto.message,
        type: dto.type || 'INFO',
        data: dto.data as Prisma.JsonObject | undefined,
      },
    });
  }

  async createForProject(dto: CreateProjectNotificationDto, projectId: string) {
    const whereClause: Prisma.ProjectMemberWhereInput = {
      projectId,
    };

    if (dto.roleNames && dto.roleNames.length > 0) {
      whereClause.role = {
        name: { in: dto.roleNames },
      };
    }

    const members = await this.prisma.projectMember.findMany({
      where: whereClause,
      select: { userId: true },
    });

    if (members.length === 0) {
      return { created: 0, notifications: [] };
    }

    const notifications = await this.prisma.notification.createMany({
      data: members.map((member) => ({
        userId: member.userId,
        title: dto.title,
        message: dto.message,
        type: dto.type || 'INFO',
        data: dto.data as Prisma.JsonObject | undefined,
      })),
    });

    return { created: notifications.count, userIds: members.map((m) => m.userId) };
  }

  async createForAllUsers(dto: CreateBulkNotificationDto) {
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    if (users.length === 0) {
      return { created: 0, notifications: [] };
    }

    const notifications = await this.prisma.notification.createMany({
      data: users.map((user) => ({
        userId: user.id,
        title: dto.title,
        message: dto.message,
        type: dto.type || 'INFO',
        data: dto.data as Prisma.JsonObject | undefined,
      })),
    });

    return { created: notifications.count, userIds: users.map((u) => u.id) };
  }

  async findAll(userId: string, pagination: PaginationDto) {
    const { page = 1, limit = 20 } = pagination;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async markAsRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async delete(id: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return this.prisma.notification.delete({ where: { id } });
  }
}
