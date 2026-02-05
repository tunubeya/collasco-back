// src/auth/tokens.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class TokensService {
  constructor(private readonly prisma: PrismaService) {}

  async hash(token: string): Promise<string> {
    return bcrypt.hash(token, 10);
  }
  async saveNew(userId: string, rawRefresh: string) {
    const tokenHash = await this.hash(rawRefresh);
    return this.prisma.userRefreshToken.create({
      data: { userId, tokenHash },
    });
  }
  async revokeAll(userId: string): Promise<void> {
    await this.prisma.userRefreshToken.deleteMany({
      where: { userId },
    });
  }

  async rotate(userId: string, oldRawRefresh: string, newRawRefresh: string): Promise<void> {
    // 1) buscar token activo
    const active = await this.prisma.userRefreshToken.findFirst({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!active) throw new Error('No active refresh token');

    // 2) validar el viejo
    const match = await bcrypt.compare(oldRawRefresh, active.tokenHash);
    if (!match) throw new Error('Invalid refresh token');

    // 3) preparar el hash del nuevo ANTES de la tx
    const newTokenHash = await this.hash(newRawRefresh);

    // 4) usar callback transaction (todo son PrismaPromises adentro)
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.userRefreshToken.deleteMany({
        where: { id: active.id },
      });
      if (deleted.count === 0) {
        throw new Error('Refresh token already used');
      }
      await tx.userRefreshToken.create({
        data: { userId, tokenHash: newTokenHash },
      });
    });
  }
}