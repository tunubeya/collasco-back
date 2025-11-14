import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TokensService } from './tokens.service';
import type { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from 'src/prisma/prisma.service';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  async validateLocal(email: string, password: string) {
    const user = await this.users.validateUser(email, password);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    return user;
  }

  private signAccessToken(payload: Record<string, any>) {
    return this.jwt.signAsync(payload, {
      expiresIn: this.cfg.get<string>('JWT_ACCESS_TTL') || '15m',
    });
  }

  private signRefreshToken(payload: Record<string, any>) {
    return this.jwt.signAsync(payload, {
      expiresIn: this.cfg.get<string>('JWT_REFRESH_TTL') || '7d',
    });
  }

  private getTokenExpirationDate(token: string): string | null {
    const decoded = this.jwt.decode(token);
    if (!decoded || typeof decoded !== 'object') return null;
    const exp = (decoded as { exp?: number }).exp;
    if (typeof exp !== 'number') return null;
    return new Date(exp * 1000).toISOString();
  }

  async issueTokensAndPersistRefresh(user: { id: string; role: UserRole; email: string }) {
    const base = { sub: user.id, role: user.role, email: user.email };
    const accessToken = await this.signAccessToken({ ...base, type: 'access' as const });
    const refreshToken = await this.signRefreshToken({ ...base, type: 'refresh' as const });
    await this.tokens.revokeAll(user.id);
    await this.tokens.saveNew(user.id, refreshToken);
    const accessTokenExpirationDate = this.getTokenExpirationDate(accessToken);
    const refreshTokenExpirationDate = this.getTokenExpirationDate(refreshToken);
    return { accessToken, refreshToken, accessTokenExpirationDate, refreshTokenExpirationDate };
  }

  async rotateRefreshToken(
    user: { id: string; role: UserRole; email: string },
    oldRefreshToken: string,
  ) {
    const base = { sub: user.id, role: user.role, email: user.email };
    const newRefreshToken = await this.signRefreshToken({ ...base, type: 'refresh' as const });

    await this.tokens.rotate(user.id, oldRefreshToken, newRefreshToken);

    const accessToken = await this.signAccessToken({ ...base, type: 'access' as const });
    const accessTokenExpirationDate = this.getTokenExpirationDate(accessToken);
    const refreshTokenExpirationDate = this.getTokenExpirationDate(newRefreshToken);
    return {
      accessToken,
      refreshToken: newRefreshToken,
      accessTokenExpirationDate,
      refreshTokenExpirationDate,
    };
  }

  async logout(userId: string) {
    await this.tokens.revokeAll(userId);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.users.getByIdOrThrow(userId);

    // Ajusta el nombre del campo según tu modelo (passwordHash / password / hash, etc.)
    const passwordHash = user.passwordHash;

    const ok = await bcrypt.compare(currentPassword, passwordHash);
    if (!ok) {
      // Tu front captura 401 -> invalidCurrentPassword y marca el fieldError
      throw new UnauthorizedException('invalidCurrentPassword');
    }

    // Política adicional (opcional)
    if (newPassword.length < 8) {
      throw new BadRequestException('weakPassword'); // tu front lo mapea como invalidPassword (400)
    }
    // Evita usar la misma
    const same = await bcrypt.compare(newPassword, passwordHash);
    if (same) {
      throw new BadRequestException('sameAsOld'); // también cae en 400
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await this.users.updatePasswordHash(userId, newHash);
  }

  async requestPasswordReset(rawEmail: string): Promise<{ message: string; token?: string }> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.users.findByEmail(email);
    if (!user) {
      return { message: 'resetEmailSent' };
    }

    await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(token);
    const expiresAt = new Date(Date.now() + this.getResetTtlMs());

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    this.sendPasswordResetEmail(user.email, token);

    const response: { message: string; token?: string } = { message: 'resetEmailSent' };
    if ((this.cfg.get<string>('NODE_ENV') ?? 'development') !== 'production') {
      response.token = token;
    }
    return response;
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!token) {
      throw new BadRequestException('invalidToken');
    }
    if (newPassword.length < 8) {
      throw new BadRequestException('weakPassword');
    }

    const tokenHash = this.hashResetToken(token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('invalidOrExpiredToken');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
      select: { passwordHash: true },
    });
    if (!user) {
      throw new BadRequestException('invalidToken');
    }

    const same = await bcrypt.compare(newPassword, user.passwordHash);
    if (same) {
      throw new BadRequestException('sameAsOld');
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await this.users.updatePasswordHash(record.userId, newHash);
    await this.tokens.revokeAll(record.userId);

    await this.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
  }

  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private getResetTtlMs(): number {
    const minutes = Number(this.cfg.get<string>('PASSWORD_RESET_TTL_MINUTES') ?? 60);
    const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
    return safeMinutes * 60 * 1000;
  }

  private sendPasswordResetEmail(email: string, token: string): void {
    const appUrl = this.cfg.get<string>('APP_URL') ?? 'http://localhost:3000';
    const resetLink = `${appUrl.replace(/\/$/, '')}/reset-password?token=${token}`;
    // Simulate e-mail sending and expose token in logs for local testing
    console.log(`[PasswordResetEmail] Sending reset link to ${email}: ${resetLink}`);
    console.log(`[PasswordResetToken] token=${token}`);
  }
}
