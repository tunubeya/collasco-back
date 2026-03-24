import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTicketDto,
  UpdateTicketDto,
  CreateTicketSectionDto,
  UpdateTicketSectionDto,
} from './dto/ticket.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  PERMISSION_KEYS,
  hasProjectPermission,
  requireProjectPermission,
} from '../projects/permissions';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';
import { GoogleCloudStorageService } from '../google-cloud-storage/google-cloud-storage.service';

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gcsService: GoogleCloudStorageService,
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

    return section;
  }

  async updateSection(
    ticketId: string,
    sectionId: string,
    dto: UpdateTicketSectionDto,
    user: AccessTokenPayload,
  ) {
    const section = await this.prisma.ticketSection.findFirst({
      where: { id: sectionId, ticketId },
      include: { ticket: { select: { projectId: true, createdById: true } } },
    });
    if (!section) throw new NotFoundException('Section not found');

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
