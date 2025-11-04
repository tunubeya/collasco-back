import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TokensService } from './tokens.service';
import type { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly tokens: TokensService,
  ) {}

  async validateLocal(email: string, password: string) {
    const user = await this.users.validateUser(email, password);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    return user;
  }

  private signAccessToken(payload: Record<string, any>) {
    return this.jwt.signAsync(payload, {
      expiresIn: this.cfg.get<string>('JWT_ACCESS_TTL') || '2m',
    });
  }

  private signRefreshToken(payload: Record<string, any>) {
    return this.jwt.signAsync(payload, {
      expiresIn: this.cfg.get<string>('JWT_REFRESH_TTL') || '15m',
    });
  }

  async issueTokensAndPersistRefresh(user: { id: string; role: UserRole; email: string }) {
    const base = { sub: user.id, role: user.role, email: user.email };
    const accessToken = await this.signAccessToken({ ...base, type: 'access' as const });
    const refreshToken = await this.signRefreshToken({ ...base, type: 'refresh' as const });

    await this.tokens.saveNew(user.id, refreshToken);
    return { accessToken, refreshToken };
  }

  async rotateRefreshToken(
    user: { id: string; role: UserRole; email: string },
    oldRefreshToken: string,
  ) {
    const base = { sub: user.id, role: user.role, email: user.email };
    const newRefreshToken = await this.signRefreshToken({ ...base, type: 'refresh' as const });

    await this.tokens.rotate(user.id, oldRefreshToken, newRefreshToken);

    const accessToken = await this.signAccessToken({ ...base, type: 'access' as const });
    return { accessToken, refreshToken: newRefreshToken };
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
}
