import {
  Injectable,
  NotFoundException,
  GoneException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketShareLinksService } from './ticket-share-links.service';
import { GoogleCloudStorageService } from '../google-cloud-storage/google-cloud-storage.service';
import { EmailService } from '../email/email.service';
import { TicketNotificationService } from './ticket-notification.service';
import { randomBytes } from 'crypto';
import { CreatePublicSectionDto, CreatePublicTicketDto } from './dto/create-public-ticket.dto';
import { UpdatePublicSectionDto } from './dto/update-public-section.dto';

@Injectable()
export class PublicTicketsService {
  private readonly RATE_LIMIT_REQUESTS = 10;
  private readonly RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
  private rateLimitCache: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly shareLinksService: TicketShareLinksService,
    private readonly gcsService: GoogleCloudStorageService,
    private readonly emailService: EmailService,
    private readonly ticketNotificationService: TicketNotificationService,
  ) {}

  private generateFollowUpToken(): string {
    return randomBytes(32).toString('hex');
  }

  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const record = this.rateLimitCache.get(ip);

    if (!record || now > record.resetAt) {
      this.rateLimitCache.set(ip, { count: 1, resetAt: now + this.RATE_LIMIT_WINDOW_MS });
      return true;
    }

    if (record.count >= this.RATE_LIMIT_REQUESTS) {
      return false;
    }

    record.count++;
    return true;
  }

  async validateLink(token: string) {
    const linkInfo = await this.shareLinksService.validateToken(token);
    if (!linkInfo) {
      throw new NotFoundException('Invalid or expired link');
    }
    return linkInfo;
  }

  async createTicket(token: string, dto: CreatePublicTicketDto, ip: string) {
    if (!this.checkRateLimit(ip)) {
      throw new ForbiddenException('Too many requests. Please try again later.');
    }

    const linkInfo = await this.shareLinksService.validateToken(token);
    if (!linkInfo) {
      throw new NotFoundException('Invalid or expired link');
    }

    if (!dto.email?.trim()) {
      throw new BadRequestException('Email is required');
    }

    const title = dto.title?.trim() || 'New ticket';
    const content = dto.content?.trim() || '';
    const followUpToken = this.generateFollowUpToken();

    const ticket = await this.prisma.ticket.create({
      data: {
        projectId: linkInfo.projectId,
        title,
        followUpToken,
        publicReporterEmail: dto.email.trim().toLowerCase(),
        publicReporterName: dto.name?.trim() || null,
        sections: {
          create: {
            type: 'DESCRIPTION',
            title,
            content,
          },
        },
      },
    });

    return {
      ticketId: ticket.id,
      followUpToken,
    };
  }

  async getTicketForFollowUp(followUpToken: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { followUpToken },
      include: {
        project: { select: { id: true, name: true } },
        sections: {
          include: {
            author: { select: { id: true, name: true, email: true } },
            lockedBy: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        images: {
          select: {
            id: true,
            name: true,
            url: true,
            mimeType: true,
            size: true,
            createdAt: true,
          },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (ticket.status === 'RESOLVED') {
      throw new GoneException('This ticket has been closed');
    }

    const now = new Date();
    const sectionsToLock = ticket.sections.filter(
      (s) =>
        s.authorId !== null &&
        s.author?.email !== ticket.publicReporterEmail &&
        s.lockedAt === null,
    );

    if (sectionsToLock.length > 0) {
      await this.prisma.ticketSection.updateMany({
        where: {
          id: { in: sectionsToLock.map((s) => s.id) },
        },
        data: {
          lockedAt: now,
        },
      });

      ticket.sections = ticket.sections.map((s) => {
        if (sectionsToLock.some((sl) => sl.id === s.id)) {
          return { ...s, lockedAt: now };
        }
        return s;
      });
    }

    return {
      id: ticket.id,
      title: ticket.title,
      status: ticket.status,
      createdAt: ticket.createdAt,
      publicReporterEmail: ticket.publicReporterEmail,
      publicReporterName: ticket.publicReporterName,
      project: ticket.project,
      sections: ticket.sections.map((s) => ({
        id: s.id,
        type: s.type,
        title: s.title,
        content: s.content,
        createdAt: s.createdAt,
        author:
          s.author && s.author.email === ticket.publicReporterEmail
            ? { email: s.author.email }
            : s.author,
        lockedAt: s.lockedAt,
        lockedBy: s.lockedBy,
      })),
      images: ticket.images,
    };
  }

  async addSection(followUpToken: string, dto: CreatePublicSectionDto, ip: string) {
    if (!this.checkRateLimit(ip)) {
      throw new ForbiddenException('Too many requests. Please try again later.');
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { followUpToken },
      include: { sections: { include: { author: true } } },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (ticket.status === 'RESOLVED') {
      throw new GoneException('This ticket has been closed');
    }

    const section = await this.prisma.ticketSection.create({
      data: {
        ticketId: ticket.id,
        type: dto.type,
        content: dto.content.trim(),
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
        lockedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { updatedAt: new Date(), version: { increment: 1 } },
    });
    // Enviar notificaciones a usuarios internos
    this.sendInternalNotifications(ticket.id).catch(console.error);

    return section;
  }

  private async sendInternalNotifications(ticketId: string) {
    const users = await this.ticketNotificationService.getUsersToNotifyForTicket(ticketId);
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { title: true },
    });
    const notificationsToCreate = users.notifyUsers.map((u) => ({
      userId: u.userId,
      title: 'New response on ticket',
      message: `Someone responded to "${ticket?.title}"`,
      type: 'INFO' as const,
      data: { ticketId, type: 'TICKET_SECTION_ADDED' },
    }));

    if (notificationsToCreate.length > 0) {
      await this.prisma.notification.createMany({
        data: notificationsToCreate,
      });
    }
    const emailRecipients = users.emailUsers;
    for (const recipient of emailRecipients) {
      this.emailService
        .sendTicketNewSectionEmail(recipient.email, ticket?.title || '', null, ticketId)
        .catch((err) =>
          console.error(
            `[PublicTickets sendInternalNotifications] email failed to=${recipient.email}:`,
            err,
          ),
        );
    }
  }

  async uploadImage(followUpToken: string, file: Express.Multer.File, name: string, ip: string) {
    if (!this.checkRateLimit(ip)) {
      throw new ForbiddenException('Too many requests. Please try again later.');
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { followUpToken },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (ticket.status === 'RESOLVED') {
      throw new GoneException('This ticket has been closed');
    }

    if (!name || !name.trim()) {
      throw new BadRequestException('Name is required');
    }

    const url = await this.gcsService.uploadFile(file);

    const image = await this.prisma.ticketImage.create({
      data: {
        ticketId: ticket.id,
        name: name.trim(),
        url,
        mimeType: file.mimetype,
        size: file.size,
      },
    });

    return image;
  }

  async updateSection(followUpToken: string, sectionId: string, dto: UpdatePublicSectionDto) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { followUpToken },
      include: {
        sections: { where: { id: sectionId } },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const section = ticket.sections[0];
    if (!section) {
      throw new NotFoundException('Section not found');
    }

    if (section.lockedAt !== null) {
      throw new ForbiddenException('Section is locked');
    }

    const updated = await this.prisma.ticketSection.update({
      where: { id: sectionId },
      data: { content: dto.content.trim() },
      include: {
        author: { select: { id: true, name: true, email: true } },
        lockedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { updatedAt: new Date() },
    });

    return {
      ...updated,
      author:
        updated.author && updated.author.email === ticket.publicReporterEmail
          ? { email: updated.author.email }
          : updated.author,
    };
  }

  async updateTicket(followUpToken: string, dto: { title?: string }) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { followUpToken },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (ticket.status === 'RESOLVED') {
      throw new GoneException('This ticket has been closed');
    }

    const data: { title?: string; version?: { increment: number } } = {};
    if (dto.title !== undefined) {
      data.title = dto.title.trim() || ticket.title;
    }
    data.version = { increment: 1 };

    const updated = await this.prisma.ticket.update({
      where: { id: ticket.id },
      data,
    });

    return {
      id: updated.id,
      title: updated.title,
      status: updated.status,
    };
  }
}
