import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTicketDto, UpdateTicketDto, CreateTicketSectionDto } from './dto/ticket.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  PERMISSION_KEYS,
  hasProjectPermission,
  requireProjectPermission,
} from '../projects/permissions';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/dto/create-notification.dto';

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(projectId: string, dto: CreateTicketDto, user: AccessTokenPayload) {
    await requireProjectPermission(this.prisma, user.sub, projectId, PERMISSION_KEYS.TICKET_CREATE);

    const ticket = await this.prisma.ticket.create({
      data: {
        projectId,
        title: dto.title,
        featureId: dto.featureId || null,
        createdById: user.sub,
      },
    });

    await this.prisma.ticketSection.create({
      data: {
        ticketId: ticket.id,
        type: 'DESCRIPTION',
        title: dto.title,
        content: dto.content,
        authorId: user.sub,
      },
    });

    return this.findById(ticket.id, user);
  }

  async findAll(projectId: string, pagination: PaginationDto, user: AccessTokenPayload) {
    const { page = 1, limit = 20 } = pagination;
    const skip = (page - 1) * limit;

    const canReadAll = await hasProjectPermission(
      this.prisma,
      user.sub,
      projectId,
      PERMISSION_KEYS.TICKET_READ_ALL,
    );

    const where: any = { projectId };
    if (!canReadAll) {
      where.createdById = user.sub;
    }

    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
          feature: { select: { id: true, name: true } },
          _count: { select: { sections: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return {
      items: items.map((t) => ({
        ...t,
        sectionsCount: t._count.sections,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string, user: AccessTokenPayload) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
        feature: { select: { id: true, name: true } },
        sections: {
          include: {
            author: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const canReadAll = await hasProjectPermission(
      this.prisma,
      user.sub,
      ticket.projectId,
      PERMISSION_KEYS.TICKET_READ_ALL,
    );
    const isOwner = ticket.createdById === user.sub;

    if (!canReadAll && !isOwner) {
      throw new ForbiddenException('You can only view your own tickets');
    }

    return ticket;
  }

  async update(id: string, dto: UpdateTicketDto, user: AccessTokenPayload) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    await requireProjectPermission(
      this.prisma,
      user.sub,
      ticket.projectId,
      PERMISSION_KEYS.TICKET_MANAGE,
    );

    return this.prisma.ticket.update({
      where: { id },
      data: {
        title: dto.title,
        status: dto.status,
        assigneeId: dto.assigneeId,
        featureId: dto.featureId,
      },
    });
  }

  async addSection(ticketId: string, dto: CreateTicketSectionDto, user: AccessTokenPayload) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { project: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const canRespond = await hasProjectPermission(
      this.prisma,
      user.sub,
      ticket.projectId,
      PERMISSION_KEYS.TICKET_RESPOND,
    );
    const isOwner = ticket.createdById === user.sub;

    if (!canRespond && !isOwner) {
      throw new ForbiddenException('You do not have permission to respond to this ticket');
    }

    const isFromTeam = await hasProjectPermission(
      this.prisma,
      user.sub,
      ticket.projectId,
      PERMISSION_KEYS.TICKET_READ_ALL,
    );
    const sectionType = isFromTeam && !isOwner ? 'RESPONSE' : dto.type;

    const section = await this.prisma.ticketSection.create({
      data: {
        ticketId,
        type: sectionType,
        title: dto.title,
        content: dto.content,
        authorId: user.sub,
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    });

    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { updatedAt: new Date() },
    });

    await this.sendNotifications(ticket, section.type, user);

    return section;
  }

  private async sendNotifications(ticket: any, sectionType: string, author: AccessTokenPayload) {
    if (sectionType === 'RESPONSE') {
      await this.notificationsService.create({
        userId: ticket.createdById,
        title: 'Nueva respuesta en tu ticket',
        message: `Han respondido a "${ticket.title}"`,
        type: NotificationType.INFO,
        data: { ticketId: ticket.id, projectId: ticket.projectId },
      });
    } else if (sectionType === 'COMMENT') {
      const members = await this.prisma.projectMember.findMany({
        where: { projectId: ticket.projectId },
        include: { user: true },
      });

      for (const member of members) {
        if (member.userId !== author.sub) {
          await this.notificationsService.create({
            userId: member.userId,
            title: 'Nuevo comentario en ticket',
            message: `${author.sub} commented on "${ticket.title}"`,
            type: NotificationType.INFO,
            data: { ticketId: ticket.id, projectId: ticket.projectId },
          });
        }
      }
    }
  }

  async findByFeature(featureId: string, user: AccessTokenPayload, pagination: PaginationDto) {
    const feature = await this.prisma.feature.findUnique({
      where: { id: featureId },
      include: { module: { select: { projectId: true } } },
    });
    if (!feature) throw new NotFoundException('Feature not found');

    const { page = 1, limit = 20 } = pagination;
    const skip = (page - 1) * limit;

    const canReadAll = await hasProjectPermission(
      this.prisma,
      user.sub,
      feature.module.projectId,
      PERMISSION_KEYS.TICKET_READ_ALL,
    );

    const where: any = { featureId };
    if (!canReadAll) {
      where.createdById = user.sub;
    }

    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
          _count: { select: { sections: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return {
      items: items.map((t) => ({
        ...t,
        sectionsCount: t._count.sections,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async searchFeaturesForAutocomplete(projectId: string, query: string, user: AccessTokenPayload) {
    await requireProjectPermission(this.prisma, user.sub, projectId, PERMISSION_KEYS.TICKET_MANAGE);

    const features = await this.prisma.feature.findMany({
      where: {
        module: { projectId },
        name: { contains: query, mode: 'insensitive' },
        deletedAt: null,
      },
      include: {
        module: {
          include: { parent: { select: { name: true, path: true } } },
        },
      },
      take: 10,
    });

    return features.map((f) => {
      const modulePath = f.module.path || f.module.name;
      const parentPath = f.module.parent?.path || f.module.parent?.name || '';
      const fullPath = parentPath
        ? `${parentPath}/${modulePath}/${f.name}`
        : `${modulePath}/${f.name}`;

      return {
        id: f.id,
        name: f.name,
        moduleId: f.moduleId,
        projectId,
        path: fullPath,
      };
    });
  }

  async findMyTickets(pagination: PaginationDto, user: AccessTokenPayload) {
    const { page = 1, limit = 20 } = pagination;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where: { createdById: user.sub },
        include: {
          project: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
          feature: { select: { id: true, name: true } },
          _count: { select: { sections: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.ticket.count({ where: { createdById: user.sub } }),
    ]);

    return {
      items: items.map((t) => ({
        ...t,
        sectionsCount: t._count.sections,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findAssignedTickets(pagination: PaginationDto, user: AccessTokenPayload) {
    const { page = 1, limit = 20 } = pagination;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where: { assigneeId: user.sub },
        include: {
          project: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
          feature: { select: { id: true, name: true } },
          _count: { select: { sections: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.ticket.count({ where: { assigneeId: user.sub } }),
    ]);

    return {
      items: items.map((t) => ({
        ...t,
        sectionsCount: t._count.sections,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
