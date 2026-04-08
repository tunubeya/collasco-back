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
import { randomBytes } from 'crypto';
import { CreatePublicTicketDto, CreatePublicSectionDto } from './dto';

@Injectable()
export class PublicTicketsService {
  private readonly RATE_LIMIT_REQUESTS = 10;
  private readonly RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
  private rateLimitCache: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly shareLinksService: TicketShareLinksService,
    private readonly gcsService: GoogleCloudStorageService,
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

    if (!dto.title?.trim()) {
      throw new BadRequestException('Title is required');
    }
    if (!dto.content?.trim()) {
      throw new BadRequestException('Content is required');
    }
    if (!dto.email?.trim()) {
      throw new BadRequestException('Email is required');
    }

    const followUpToken = this.generateFollowUpToken();

    const ticket = await this.prisma.ticket.create({
      data: {
        projectId: linkInfo.projectId,
        title: dto.title.trim(),
        followUpToken,
        publicReporterEmail: dto.email.trim().toLowerCase(),
        createdById: linkInfo.projectId,
        sections: {
          create: {
            type: 'DESCRIPTION',
            title: dto.title.trim(),
            content: dto.content.trim(),
            authorId: linkInfo.projectId,
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

    return {
      id: ticket.id,
      title: ticket.title,
      status: ticket.status,
      createdAt: ticket.createdAt,
      publicReporterEmail: ticket.publicReporterEmail,
      project: ticket.project,
      sections: ticket.sections.map((s) => ({
        id: s.id,
        type: s.type,
        title: s.title,
        content: s.content,
        createdAt: s.createdAt,
        author:
          s.author.email === ticket.publicReporterEmail ? { email: s.author.email } : s.author,
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

    const isPublicEmail = ticket.publicReporterEmail === dto.email.trim().toLowerCase();

    const section = await this.prisma.ticketSection.create({
      data: {
        ticketId: ticket.id,
        type: dto.type,
        content: dto.content.trim(),
        authorId: ticket.publicReporterEmail!,
      },
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
      ...section,
      isPublicAuthor: isPublicEmail,
    };
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
        uploadedById: ticket.publicReporterEmail!,
      },
    });

    return image;
  }
}
