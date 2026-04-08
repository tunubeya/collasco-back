import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PERMISSION_KEYS,
  requireProjectPermission,
  hasProjectPermission,
} from '../projects/permissions';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';
import { randomBytes } from 'crypto';

@Injectable()
export class TicketShareLinksService {
  constructor(private readonly prisma: PrismaService) {}

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  async create(projectId: string, user: AccessTokenPayload) {
    await requireProjectPermission(this.prisma, user.sub, projectId, PERMISSION_KEYS.TICKET_CREATE);

    const token = this.generateToken();

    const shareLink = await this.prisma.ticketShareLink.create({
      data: {
        projectId,
        token,
        createdById: user.sub,
      },
      select: {
        id: true,
        token: true,
        createdAt: true,
      },
    });

    return shareLink;
  }

  async list(projectId: string, user: AccessTokenPayload) {
    const canReadAll = await hasProjectPermission(
      this.prisma,
      user.sub,
      projectId,
      PERMISSION_KEYS.TICKET_READ_ALL,
    );

    if (!canReadAll) {
      throw new ForbiddenException('You do not have permission to view share links');
    }

    const links = await this.prisma.ticketShareLink.findMany({
      where: {
        projectId,
        revokedAt: null,
      },
      select: {
        id: true,
        token: true,
        createdAt: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        ticket: {
          select: { id: true, title: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return links;
  }

  async refresh(projectId: string, linkId: string, user: AccessTokenPayload) {
    await requireProjectPermission(this.prisma, user.sub, projectId, PERMISSION_KEYS.TICKET_CREATE);

    const link = await this.prisma.ticketShareLink.findFirst({
      where: { id: linkId, projectId, revokedAt: null },
    });

    if (!link) {
      throw new NotFoundException('Share link not found');
    }

    const newToken = this.generateToken();

    await this.prisma.ticketShareLink.update({
      where: { id: linkId },
      data: { revokedAt: new Date() },
    });

    const refreshedLink = await this.prisma.ticketShareLink.create({
      data: {
        projectId,
        token: newToken,
        createdById: user.sub,
      },
      select: {
        id: true,
        token: true,
        createdAt: true,
      },
    });

    return refreshedLink;
  }

  async revoke(projectId: string, linkId: string, user: AccessTokenPayload) {
    await requireProjectPermission(this.prisma, user.sub, projectId, PERMISSION_KEYS.TICKET_MANAGE);

    const link = await this.prisma.ticketShareLink.findFirst({
      where: { id: linkId, projectId, revokedAt: null },
    });

    if (!link) {
      throw new NotFoundException('Share link not found');
    }

    await this.prisma.ticketShareLink.update({
      where: { id: linkId },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  }

  async validateToken(token: string) {
    const link = await this.prisma.ticketShareLink.findUnique({
      where: { token },
      include: {
        project: { select: { id: true, name: true } },
      },
    });

    if (!link || link.revokedAt) {
      return null;
    }

    return {
      projectId: link.projectId,
      projectName: link.project.name,
      active: true,
    };
  }
}
