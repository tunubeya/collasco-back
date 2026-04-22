import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async createDeveloper(email: string, password: string, name?: string) {
    const passwordHash = await bcrypt.hash(password, 10);
    return this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role: UserRole.DEVELOPER,
        name,
      },
    });
  }
  async createClient(email: string, password: string, name?: string) {
    // companyName se ignora en el nuevo modelo (no hay clientAccount)
    const passwordHash = await bcrypt.hash(password, 10);
    return this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role: UserRole.TESTER, // ajusta si quieres otro rol por defecto
        name,
      },
    });
  }

  async validateUser(email: string, password: string) {
    const user = await this.findByEmail(email);
    if (!user || !user.passwordHash) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? user : null;
  }

  async getByIdOrThrow(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: {
        githubIdentity: true,
        // Opcionalmente, da contexto de proyectos:
        ownedProjects: { select: { id: true, name: true, slug: true } },
        memberships: {
          include: {
            project: { select: { id: true, name: true, ownerId: true } },
          },
        },
      },
    });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        githubIdentity: true,
        ownedProjects: { select: { id: true, name: true, slug: true } },
        memberships: {
          include: {
            project: { select: { id: true, name: true, ownerId: true } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(userId: string, dto: UpdateUserDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name ?? undefined,
        email: dto.email ?? undefined,
      },
    });
  }

  async updateTicketNotificationPrefs(userId: string, dto: { notifyAssignedTickets?: boolean; notifyUnassignedTickets?: boolean; emailAssignedTickets?: boolean; emailUnassignedTickets?: boolean }) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        notifyAssignedTickets: dto.notifyAssignedTickets,
        notifyUnassignedTickets: dto.notifyUnassignedTickets,
        emailAssignedTickets: dto.emailAssignedTickets,
        emailUnassignedTickets: dto.emailUnassignedTickets,
      },
    });

    await this.syncTicketNotifications(userId, user, {
      syncNotifyAssigned: dto.notifyAssignedTickets !== undefined,
      syncNotifyUnassigned: dto.notifyUnassignedTickets !== undefined,
      syncEmailAssigned: dto.emailAssignedTickets !== undefined,
      syncEmailUnassigned: dto.emailUnassignedTickets !== undefined,
    });

    return user;
  }

  private async syncTicketNotifications(userId: string, user: { notifyAssignedTickets: boolean; notifyUnassignedTickets: boolean; emailAssignedTickets: boolean; emailUnassignedTickets: boolean }, flags: { syncNotifyAssigned: boolean; syncNotifyUnassigned: boolean; syncEmailAssigned: boolean; syncEmailUnassigned: boolean }) {
    if (flags.syncNotifyAssigned) {
      if (user.notifyAssignedTickets) {
        const tickets = await this.prisma.ticket.findMany({
          where: { assigneeId: userId },
          select: { id: true, title: true },
        });
        await this.prisma.ticketNotifyUser.createMany({
          data: tickets.map((t) => ({ ticketId: t.id, userId })),
          skipDuplicates: true,
        });
      } else {
        const deleted = await this.prisma.ticketNotifyUser.deleteMany({
          where: { userId, ticket: { assigneeId: userId } },
        });
      }
    }

    if (flags.syncNotifyUnassigned) {
      const accessibleProjectIds = await this.prisma.projectMember.findMany({
        where: { userId },
        select: { projectId: true },
      });
      const projectIds = accessibleProjectIds.map((p) => p.projectId);
      if (user.notifyUnassignedTickets) {
        const tickets = await this.prisma.ticket.findMany({
          where: {
            projectId: { in: projectIds },
            OR: [{ assigneeId: null }, { assigneeId: { not: userId } }],
          },
          select: { id: true, title: true, assigneeId: true },
        });
        await this.prisma.ticketNotifyUser.createMany({
          data: tickets.map((t) => ({ ticketId: t.id, userId })),
          skipDuplicates: true,
        });
      } else {
        const deleted = await this.prisma.ticketNotifyUser.deleteMany({
          where: {
            userId,
            ticket: { projectId: { in: projectIds } },
          },
        });
      }
    }
    if (flags.syncEmailAssigned) {
      if (user.emailAssignedTickets) {
        const tickets = await this.prisma.ticket.findMany({
          where: { assigneeId: userId },
          select: { id: true, title: true },
        });
        await this.prisma.ticketEmailUser.createMany({
          data: tickets.map((t) => ({ ticketId: t.id, userId })),
          skipDuplicates: true,
        });
      } else {
        const deleted = await this.prisma.ticketEmailUser.deleteMany({
          where: { userId, ticket: { assigneeId: userId } },
        });
      }
    }
    if (flags.syncEmailUnassigned) {
      const accessibleProjectIds = await this.prisma.projectMember.findMany({
        where: { userId },
        select: { projectId: true },
      });
      const projectIds = accessibleProjectIds.map((p) => p.projectId);
      if (user.emailUnassignedTickets) {
        const tickets = await this.prisma.ticket.findMany({
          where: {
            projectId: { in: projectIds },
            OR: [{ assigneeId: null }, { assigneeId: { not: userId } }],
          },
          select: { id: true, title: true, assigneeId: true },
        });
        await this.prisma.ticketEmailUser.createMany({
          data: tickets.map((t) => ({ ticketId: t.id, userId })),
          skipDuplicates: true,
        });
} else {
        const deleted = await this.prisma.ticketEmailUser.deleteMany({
          where: {
            userId,
            ticket: { projectId: { in: projectIds } },
          },
        });
      }
    }
  }

  async updatePasswordHash(id: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash },
      select: { id: true },
    });
  }
}
