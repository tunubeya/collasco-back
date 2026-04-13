import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TicketNotificationService {
  private readonly logger = new Logger(TicketNotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async addUserToTicketNotify(userId: string, ticketId: string) {
    this.logger.log(`[addUserToTicketNotify] userId=${userId}, ticketId=${ticketId}`);
    return this.prisma.ticketNotifyUser.upsert({
      where: {
        ticketId_userId: { ticketId, userId },
      },
      create: { ticketId, userId },
      update: {},
      include: {
        ticket: { select: { id: true, title: true } },
        user: { select: { id: true, email: true, name: true } },
      },
    });
  }

  async addUserToTicketEmail(userId: string, ticketId: string) {
    this.logger.log(`[addUserToTicketEmail] userId=${userId}, ticketId=${ticketId}`);
    return this.prisma.ticketEmailUser.upsert({
      where: {
        ticketId_userId: { ticketId, userId },
      },
      create: { ticketId, userId },
      update: {},
      include: {
        ticket: { select: { id: true, title: true } },
        user: { select: { id: true, email: true, name: true } },
      },
    });
  }

  async removeUserFromTicketNotify(userId: string, ticketId: string) {
    this.logger.log(`[removeUserFromTicketNotify] userId=${userId}, ticketId=${ticketId}`);
    return this.prisma.ticketNotifyUser.delete({
      where: {
        ticketId_userId: { ticketId, userId },
      },
    });
  }

  async removeUserFromTicketEmail(userId: string, ticketId: string) {
    this.logger.log(`[removeUserFromTicketEmail] userId=${userId}, ticketId=${ticketId}`);
    return this.prisma.ticketEmailUser.delete({
      where: {
        ticketId_userId: { ticketId, userId },
      },
    });
  }

  async bulkAddTicketsNotify(userId: string, ticketIds: string[]) {
    this.logger.log(
      `[bulkAddTicketsNotify] userId=${userId}, ticketIds=${JSON.stringify(ticketIds)}`,
    );
    const data = ticketIds.map((ticketId) => ({ ticketId, userId }));
    await this.prisma.ticketNotifyUser.createMany({
      data,
      skipDuplicates: true,
    });
    return { count: ticketIds.length };
  }

  async bulkAddTicketsEmail(userId: string, ticketIds: string[]) {
    this.logger.log(
      `[bulkAddTicketsEmail] userId=${userId}, ticketIds=${JSON.stringify(ticketIds)}`,
    );
    const data = ticketIds.map((ticketId) => ({ ticketId, userId }));
    await this.prisma.ticketEmailUser.createMany({
      data,
      skipDuplicates: true,
    });
    return { count: ticketIds.length };
  }

  async getUsersToNotifyForTicket(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        notifyUsers: {
          include: {
            user: { select: { id: true, email: true, name: true } },
          },
        },
        emailUsers: {
          include: {
            user: { select: { id: true, email: true, name: true } },
          },
        },
      },
    });

    if (!ticket) return { notifyUsers: [], emailUsers: [] };

    return {
      notifyUsers: ticket.notifyUsers.map((u) => ({
        userId: u.user.id,
        email: u.user.email,
        name: u.user.name,
      })),
      emailUsers: ticket.emailUsers.map((u) => ({
        userId: u.user.id,
        email: u.user.email,
        name: u.user.name,
      })),
    };
  }
}
