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
        // isActive/role/lastLoginAt siguen reservados (admin)
      },
    });
  }
  async updatePasswordHash(id: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash },
      select: { id: true }, // evita retornar hash por seguridad
    });
  }
}
