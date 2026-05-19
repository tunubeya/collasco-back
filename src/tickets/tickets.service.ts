import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTicketDto,
  UpdateTicketDto,
  CreateTicketSectionDto,
  UpdateTicketSectionDto,
  ListTicketsQueryDto,
  TicketScope,
  TicketStatus,
} from './dto/ticket.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  PERMISSION_KEYS,
  hasProjectPermission,
  requireProjectPermission,
} from '../projects/permissions';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';
import { GoogleCloudStorageService } from '../google-cloud-storage/google-cloud-storage.service';
import { EmailService } from '../email/email.service';
import { TicketNotificationService } from './ticket-notification.service';

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gcsService: GoogleCloudStorageService,
    private readonly emailService: EmailService,
    private readonly ticketNotificationService: TicketNotificationService,
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

    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      select: {
        userId: true,
        user: {
          select: {
            notifyUnassignedTickets: true,
            emailUnassignedTickets: true,
          },
        },
      },
    });

    const notifyUsersToAdd = members
      .filter((m) => m.user.notifyUnassignedTickets)
      .map((m) => ({ ticketId: ticket.id, userId: m.userId }));

    const emailUsersToAdd = members
      .filter((m) => m.user.emailUnassignedTickets)
      .map((m) => ({ ticketId: ticket.id, userId: m.userId }));

    if (notifyUsersToAdd.length > 0) {
      await this.prisma.ticketNotifyUser.createMany({
        data: notifyUsersToAdd,
        skipDuplicates: true,
      });
    }
    if (emailUsersToAdd.length > 0) {
      await this.prisma.ticketEmailUser.createMany({
        data: emailUsersToAdd,
        skipDuplicates: true,
      });
    }

    // Send notifications to users with unassigned ticket preferences
    void this.sendNewTicketNotification(ticket.id);

    return this.findById(ticket.id, user);
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
            lockedBy: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        notifyUsers: { where: { userId: user.sub } },
        emailUsers: { where: { userId: user.sub } },
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

    const lastMessageSection = ticket.sections
      .filter((s) => s.type === 'RESPONSE' || s.type === 'COMMENT')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    await this.prisma.ticketReadReceipt.upsert({
      where: { userId_ticketId: { userId: user.sub, ticketId: ticket.id } },
      create: { userId: user.sub, ticketId: ticket.id, lastSeenVersion: ticket.version },
      update: { lastSeenVersion: ticket.version },
    });

    return {
      ...ticket,
      lastMessageId: lastMessageSection?.id || null,
      receiveNotifications: ticket.notifyUsers.length > 0,
      receiveEmails: ticket.emailUsers.length > 0,
    };
  }

  async openTicket(id: string, user: AccessTokenPayload) {
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
            lockedBy: { select: { id: true, name: true, email: true } },
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

    const now = new Date();
    const sectionsToLock = ticket.sections.filter(
      (s) => s.authorId !== user.sub && s.lockedAt === null,
    );

    if (sectionsToLock.length > 0) {
      await this.prisma.ticketSection.updateMany({
        where: {
          id: { in: sectionsToLock.map((s) => s.id) },
        },
        data: {
          lockedAt: now,
          lockedById: user.sub,
        },
      });

      ticket.sections = ticket.sections.map((s) => {
        if (sectionsToLock.some((sl) => sl.id === s.id)) {
          return { ...s, lockedAt: now, lockedById: user.sub };
        }
        return s;
      });
    }

    const lastMessageSection = ticket.sections
      .filter((s) => s.type === 'RESPONSE' || s.type === 'COMMENT')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    return {
      ...ticket,
      lastMessageId: lastMessageSection?.id || null,
    };
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

    if (dto.assigneeId !== undefined && dto.assigneeId !== ticket.assigneeId) {
      const oldAssigneeId = ticket.assigneeId;
      const newAssigneeId = dto.assigneeId;
      const projectId = ticket.projectId;
      if (oldAssigneeId && newAssigneeId) {
        await this.prisma.ticketNotifyUser.deleteMany({
          where: { ticketId: id, userId: oldAssigneeId },
        });
        await this.prisma.ticketEmailUser.deleteMany({
          where: { ticketId: id, userId: oldAssigneeId },
        });
        const oldPrefs = await this.prisma.user.findUnique({
          where: { id: oldAssigneeId },
          select: { notifyUnassignedTickets: true, emailUnassignedTickets: true },
        });
        if (oldPrefs?.notifyUnassignedTickets) {
          const isMember = await this.prisma.projectMember.findFirst({
            where: { userId: oldAssigneeId, projectId },
          });
          if (isMember) {
            await this.prisma.ticketNotifyUser.createMany({
              data: [{ ticketId: id, userId: oldAssigneeId }],
              skipDuplicates: true,
            });
          }
        }
        if (oldPrefs?.emailUnassignedTickets) {
          const isMember = await this.prisma.projectMember.findFirst({
            where: { userId: oldAssigneeId, projectId },
          });
          if (isMember) {
            await this.prisma.ticketEmailUser.createMany({
              data: [{ ticketId: id, userId: oldAssigneeId }],
              skipDuplicates: true,
            });
          }
        }

        // Apply assigned defaults for new assignee
        const newAssigneePrefs = await this.prisma.user.findUnique({
          where: { id: newAssigneeId },
          select: { notifyAssignedTickets: true, emailAssignedTickets: true },
        });
        if (newAssigneePrefs?.notifyAssignedTickets) {
          await this.prisma.ticketNotifyUser.createMany({
            data: [{ ticketId: id, userId: newAssigneeId }],
            skipDuplicates: true,
          });
        }
        if (newAssigneePrefs?.emailAssignedTickets) {
          await this.prisma.ticketEmailUser.createMany({
            data: [{ ticketId: id, userId: newAssigneeId }],
            skipDuplicates: true,
          });
        }

        // Send reassignment notification using preferences
        void this.sendTicketAssignedNotification(id, newAssigneeId, 'reassigned', user.sub);
      } else if (oldAssigneeId && !newAssigneeId) {
        // Assigned -> Unassigned
        await this.prisma.ticketNotifyUser.deleteMany({
          where: { ticketId: id, userId: oldAssigneeId },
        });
        await this.prisma.ticketEmailUser.deleteMany({
          where: { ticketId: id, userId: oldAssigneeId },
        });

        // Use unassigned defaults for all project members
        const members = await this.prisma.projectMember.findMany({
          where: { projectId },
          select: {
            userId: true,
            user: {
              select: {
                notifyUnassignedTickets: true,
                emailUnassignedTickets: true,
              },
            },
          },
        });

        const notifyUsersToAdd = members
          .filter((m) => m.user.notifyUnassignedTickets)
          .map((m) => ({ ticketId: id, userId: m.userId }));

        const emailUsersToAdd = members
          .filter((m) => m.user.emailUnassignedTickets)
          .map((m) => ({ ticketId: id, userId: m.userId }));

        if (notifyUsersToAdd.length > 0) {
          await this.prisma.ticketNotifyUser.createMany({
            data: notifyUsersToAdd,
            skipDuplicates: true,
          });
        }
        if (emailUsersToAdd.length > 0) {
          await this.prisma.ticketEmailUser.createMany({
            data: emailUsersToAdd,
            skipDuplicates: true,
          });
        }
      } else if (!oldAssigneeId && newAssigneeId) {
        // Unassigned -> Assigned
        // Use assigned defaults for the new assignee
        const newAssigneePrefs = await this.prisma.user.findUnique({
          where: { id: newAssigneeId },
          select: { notifyAssignedTickets: true, emailAssignedTickets: true },
        });
        if (newAssigneePrefs?.notifyAssignedTickets) {
          await this.prisma.ticketNotifyUser.createMany({
            data: [{ ticketId: id, userId: newAssigneeId }],
            skipDuplicates: true,
          });
        }
        if (newAssigneePrefs?.emailAssignedTickets) {
          await this.prisma.ticketEmailUser.createMany({
            data: [{ ticketId: id, userId: newAssigneeId }],
            skipDuplicates: true,
          });
        }
        // Send assignment notification using preferences
        this.sendTicketAssignedNotification(id, newAssigneeId, 'assigned', user.sub).catch(
          console.error,
        );
      }
    }

    const updatedTicket = await this.prisma.ticket.update({
      where: { id },
      data: {
        title: dto.title,
        status: dto.status,
        assigneeId: dto.assigneeId,
        featureId: dto.featureId,
        version: { increment: 1 },
      },
    });

    // Update read receipt for the user who made the change
    await this.prisma.ticketReadReceipt.upsert({
      where: { userId_ticketId: { ticketId: id, userId: user.sub } },
      create: { ticketId: id, userId: user.sub, lastSeenVersion: updatedTicket.version },
      update: { lastSeenVersion: updatedTicket.version },
    });

    return updatedTicket;
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
      data: { updatedAt: new Date(), version: { increment: 1 } },
    });

    // Update read receipt for the user who made the change
    const updatedTicket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { version: true },
    });
    if (updatedTicket) {
      await this.prisma.ticketReadReceipt.upsert({
        where: { userId_ticketId: { ticketId, userId: user.sub } },
        create: { ticketId: ticketId, userId: user.sub, lastSeenVersion: updatedTicket.version },
        update: { lastSeenVersion: updatedTicket.version },
      });
    }

    if (ticket.publicReporterEmail && ticket.followUpToken) {
      this.emailService
        .sendTicketNewSectionEmail(ticket.publicReporterEmail, ticket.title, ticket.followUpToken)
        .catch((err) => console.error(`[addSection] public email failed:`, err));
    }

    this.sendInternalNotifications(ticketId, user.sub).catch(console.error);

    return section;
  }

  private async sendInternalNotifications(ticketId: string, authorId: string) {
    const users = await this.ticketNotificationService.getUsersToNotifyForTicket(ticketId);
    const author = await this.prisma.user.findUnique({
      where: { id: authorId },
      select: { name: true },
    });

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { title: true },
    });

    const notificationsToCreate = users.notifyUsers
      .filter((u) => u.userId !== authorId)
      .map((u) => ({
        userId: u.userId,
        title: 'New response on ticket',
        message: `${author?.name || 'Someone'} responded to "${ticket?.title}"`,
        type: 'INFO' as const,
        data: { ticketId, type: 'TICKET_SECTION_ADDED' },
      }));

    if (notificationsToCreate.length > 0) {
      await this.prisma.notification.createMany({
        data: notificationsToCreate,
      });
    }

    const emailRecipients = users.emailUsers.filter((u) => u.userId !== authorId);

    for (const recipient of emailRecipients) {
      void this.emailService.sendTicketNewSectionEmail(
        recipient.email,
        ticket?.title || '',
        null,
        ticketId,
      );
    }
  }

  private async sendTicketAssignedNotification(
    ticketId: string,
    userId: string,
    type: 'assigned' | 'reassigned',
    actorId?: string,
  ) {
    if (actorId === userId) return;

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { title: true },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });

    if (!ticket || !user) return;

    const notifyRecord = await this.prisma.ticketNotifyUser.findUnique({
      where: { ticketId_userId: { ticketId, userId } },
    });

    if (notifyRecord) {
      await this.prisma.notification.create({
        data: {
          userId,
          title: type === 'reassigned' ? 'Ticket reassigned' : 'Ticket assigned',
          message:
            type === 'reassigned'
              ? `You have been reassigned to "${ticket.title}"`
              : `You have been assigned to "${ticket.title}"`,
          type: 'INFO',
          data: {
            ticketId,
            type: type === 'reassigned' ? 'TICKET_REASSIGNED' : 'TICKET_ASSIGNED',
          },
        },
      });
    }

    const emailRecord = await this.prisma.ticketEmailUser.findUnique({
      where: { ticketId_userId: { ticketId, userId } },
    });

    if (emailRecord) {
      void this.emailService.sendTicketAssignedEmail(user.email, ticket.title, ticketId);
    }
  }

  private async sendNewTicketNotification(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { title: true, projectId: true },
    });

    if (!ticket) return;

    const members = await this.prisma.projectMember.findMany({
      where: { projectId: ticket.projectId },
      select: {
        userId: true,
        user: {
          select: {
            name: true,
            email: true,
            notifyUnassignedTickets: true,
            emailUnassignedTickets: true,
          },
        },
      },
    });

    for (const member of members) {
      if (member.user.notifyUnassignedTickets) {
        await this.prisma.notification.create({
          data: {
            userId: member.userId,
            title: 'New ticket created',
            message: `A new ticket "${ticket.title}" has been created`,
            type: 'INFO',
            data: { ticketId, type: 'TICKET_CREATED' },
          },
        });
      }

      if (member.user.emailUnassignedTickets) {
        void this.emailService.sendTicketCreatedEmail(
          member.user.email,
          ticket.title,
          ticketId,
        );
      }
    }
  }

  async updateSection(
    ticketId: string,
    sectionId: string,
    dto: UpdateTicketSectionDto,
    user: AccessTokenPayload,
  ) {
    const section = await this.prisma.ticketSection.findFirst({
      where: { id: sectionId, ticketId },
      include: {
        ticket: { select: { projectId: true, createdById: true } },
        lockedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!section) throw new NotFoundException('Section not found');

    if (section.lockedAt !== null) {
      throw new ForbiddenException('This section is locked and cannot be edited');
    }

    const isAuthor = section.authorId === user.sub;
    const canManage = await hasProjectPermission(
      this.prisma,
      user.sub,
      section.ticket.projectId,
      PERMISSION_KEYS.TICKET_MANAGE,
    );

    if (!isAuthor && !canManage) {
      throw new ForbiddenException('You can only edit your own sections');
    }

    return this.prisma.ticketSection.update({
      where: { id: sectionId },
      data: {
        content: dto.content,
        title: dto.title,
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
        lockedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async delete(ticketId: string, user: AccessTokenPayload) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { images: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const canManage = await hasProjectPermission(
      this.prisma,
      user.sub,
      ticket.projectId,
      PERMISSION_KEYS.TICKET_MANAGE,
    );
    const isOwner = ticket.createdById === user.sub;

    if (!canManage && !isOwner) {
      throw new ForbiddenException('You can only delete your own tickets');
    }

    if (ticket.images.length > 0) {
      const urls = ticket.images.map((img) => img.url);
      await this.gcsService.deleteFiles(urls);
    }

    await this.prisma.ticket.delete({ where: { id: ticketId } });

    return { success: true };
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

  async list(query: ListTicketsQueryDto, user: AccessTokenPayload) {
    const { page = 1, limit = 20, scope, projectId, status } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.TicketWhereInput = {};
    const accessWhere = await this.getTicketReadAccessWhere(user.sub, projectId);

    Object.assign(where, accessWhere);

    if (scope === TicketScope.MINE) {
      where.createdById = user.sub;
    } else if (scope === TicketScope.ASSIGNED) {
      where.assigneeId = user.sub;
    } else if (scope === TicketScope.UNASSIGNED) {
      where.assigneeId = null;
    } else if (scope === TicketScope.RESOLVED) {
      where.status = TicketStatus.RESOLVED;
    } else if (scope === TicketScope.EXTERNAL) {
      where.NOT = { publicReporterEmail: null };
    }

    // Filtrar status (solo OPEN o PENDING, nunca RESOLVED a menos que sea scope RESOLVED)
    if (scope !== TicketScope.RESOLVED) {
      if (status) {
        where.status = status;
      } else {
        where.status = { in: [TicketStatus.OPEN, TicketStatus.PENDING] };
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: {
          project: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true } },
          feature: { select: { id: true, name: true } },
          _count: { select: { sections: true } },
          readReceipts: {
            where: { userId: user.sub },
            select: { lastSeenVersion: true },
          },
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
        unreadCount: Math.max(0, t.version - (t.readReceipts[0]?.lastSeenVersion ?? 0)),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getCounts(userId: string, projectId?: string) {
    const accessWhere = await this.getTicketReadAccessWhere(userId, projectId);

    if (accessWhere.OR?.length === 0) {
      return { counts: { all: 0, mine: 0, assigned: 0, unassigned: 0, resolved: 0, external: 0 } };
    }

    const activeStatus = { in: [TicketStatus.OPEN, TicketStatus.PENDING] };

    const [all, mine, assigned, unassigned, resolved, external] = await Promise.all([
      this.prisma.ticket.count({ where: { ...accessWhere, status: activeStatus } }),
      this.prisma.ticket.count({
        where: { ...accessWhere, status: activeStatus, createdById: userId },
      }),
      this.prisma.ticket.count({
        where: { ...accessWhere, status: activeStatus, assigneeId: userId },
      }),
      this.prisma.ticket.count({
        where: { ...accessWhere, status: activeStatus, assigneeId: null },
      }),
      this.prisma.ticket.count({ where: { ...accessWhere, status: TicketStatus.RESOLVED } }),
      this.prisma.ticket.count({ where: { ...accessWhere, NOT: { publicReporterEmail: null } } }),
    ]);
    return { counts: { all, mine, assigned, unassigned, resolved, external } };
  }

  private async getTicketReadAccessWhere(
    userId: string,
    projectId?: string,
  ): Promise<Prisma.TicketWhereInput> {
    const memberships = await this.prisma.projectMember.findMany({
      where: {
        userId,
        ...(projectId ? { projectId } : {}),
      },
      select: {
        projectId: true,
        role: {
          select: {
            isOwner: true,
            rolePermissions: {
              select: { permission: { select: { key: true } } },
            },
          },
        },
      },
    });

    const readAllProjectIds: string[] = [];
    const readOwnProjectIds: string[] = [];

    for (const membership of memberships) {
      if (membership.role.isOwner) {
        readAllProjectIds.push(membership.projectId);
        continue;
      }

      const permissions = membership.role.rolePermissions.map((rp) => rp.permission.key);
      if (permissions.includes(PERMISSION_KEYS.TICKET_READ_ALL)) {
        readAllProjectIds.push(membership.projectId);
      } else if (permissions.includes(PERMISSION_KEYS.TICKET_READ_OWN)) {
        readOwnProjectIds.push(membership.projectId);
      }
    }

    const accessConditions: Prisma.TicketWhereInput[] = [];
    if (readAllProjectIds.length > 0) {
      accessConditions.push({ projectId: { in: readAllProjectIds } });
    }
    if (readOwnProjectIds.length > 0) {
      accessConditions.push({
        projectId: { in: readOwnProjectIds },
        createdById: userId,
      });
    }

    if (accessConditions.length === 0) {
      return { OR: [] };
    }
    if (accessConditions.length === 1) {
      return accessConditions[0];
    }
    return { OR: accessConditions };
  }

  async uploadImage(
    ticketId: string,
    file: Express.Multer.File,
    name: string,
    user: AccessTokenPayload,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { projectId: true, createdById: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const canReadAll = await hasProjectPermission(
      this.prisma,
      user.sub,
      ticket.projectId,
      PERMISSION_KEYS.TICKET_READ_ALL,
    );
    const isOwner = ticket.createdById === user.sub;

    if (!canReadAll && !isOwner) {
      throw new ForbiddenException('You can only manage images in your own tickets');
    }

    if (!name || !name.trim()) {
      throw new BadRequestException('Name is required');
    }

    const existingImage = await this.prisma.ticketImage.findFirst({
      where: { ticketId, name: name.trim() },
    });
    if (existingImage) {
      throw new BadRequestException('An image with this name already exists in this ticket');
    }

    const url = await this.gcsService.uploadFile(file);

    const image = await this.prisma.ticketImage.create({
      data: {
        ticketId,
        name: name.trim(),
        url,
        mimeType: file.mimetype,
        size: file.size,
        uploadedById: user.sub,
      },
    });

    return image;
  }

  async getImages(ticketId: string, user: AccessTokenPayload) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { projectId: true, createdById: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const canReadAll = await hasProjectPermission(
      this.prisma,
      user.sub,
      ticket.projectId,
      PERMISSION_KEYS.TICKET_READ_ALL,
    );
    const isOwner = ticket.createdById === user.sub;

    if (!canReadAll && !isOwner) {
      throw new ForbiddenException('You can only view images in your own tickets');
    }

    return this.prisma.ticketImage.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteImage(ticketId: string, imageId: string, user: AccessTokenPayload) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { projectId: true, createdById: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const canReadAll = await hasProjectPermission(
      this.prisma,
      user.sub,
      ticket.projectId,
      PERMISSION_KEYS.TICKET_READ_ALL,
    );
    const isOwner = ticket.createdById === user.sub;

    if (!canReadAll && !isOwner) {
      throw new ForbiddenException('You can only manage images in your own tickets');
    }

    const image = await this.prisma.ticketImage.findFirst({
      where: { id: imageId, ticketId },
    });
    if (!image) throw new NotFoundException('Image not found');

    await this.prisma.ticketImage.delete({ where: { id: imageId } });
    await this.gcsService.deleteFile(image.url);

    return { success: true };
  }
}
