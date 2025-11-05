import { Body, Controller, Get, HttpCode, Post, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle, minutes } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from '../users/dto/register.dto';
import { JwtAccessGuard } from './guards/jwt-access.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import type { Request } from 'express';
import type { AccessTokenPayload, RefreshTokenPayload } from './types/jwt-payload';
import { RegisterClientDto } from '../users/dto/register-client.dto';
import type { UserRole } from '@prisma/client';
import { getBearerToken } from './bearer.util';
import { ChangePasswordDto } from 'src/users/dto/change-password.dto';

type LocalAuthedUser = { id: string; email: string; role: UserRole };
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ auth: { limit: 10, ttl: minutes(1) } })
  async register(@Body() dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    console.log(
      'Registering user with email:',
      email,
      'and name:',
      dto.name,
      'and password:',
      dto.password,
    );

    const user = await this.users.createDeveloper(email, dto.password, dto.name);
    const tokens = await this.auth.issueTokensAndPersistRefresh({
      id: user.id,
      role: user.role,
      email: user.email,
    });
    return { user: { id: user.id, email: user.email, role: user.role }, ...tokens };
  }

  @Public()
  @UseGuards(AuthGuard('local'))
  @Post('login')
  @HttpCode(200)
  @Throttle({ auth: { limit: 10, ttl: minutes(1) } })
  async login(@Req() req: Request) {
    console.log('Login attempt with body:', req.body);
    const user = req.user as LocalAuthedUser;
    const tokens = await this.auth.issueTokensAndPersistRefresh({
      id: user.id,
      role: user.role,
      email: user.email,
    });
    return { user: { id: user.id, email: user.email, role: user.role }, ...tokens };
  }

  @UseGuards(JwtAccessGuard)
  @Get('me')
  me(@CurrentUser() user: AccessTokenPayload) {
    const { sub, email, role } = user;
    return { id: sub, email, role };
  }

  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @CurrentUser() user: RefreshTokenPayload) {
    console.log("Refresing token");
    const oldRefreshToken = getBearerToken(req) ?? '';
    const tokens = await this.auth.rotateRefreshToken(
      { id: user.sub, email: user.email, role: user.role },
      oldRefreshToken,
    );
    return tokens;
  }

  @UseGuards(JwtAccessGuard)
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AccessTokenPayload) {
    await this.auth.logout(user.sub);
    return { ok: true };
  }
  @Public()
  @Post('register-client')
  @Throttle({ auth: { limit: 10, ttl: minutes(1) } })
  async registerClient(@Body() dto: RegisterClientDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users.createClient(email, dto.password, dto.name);
    const tokens = await this.auth.issueTokensAndPersistRefresh({
      id: user.id,
      role: user.role,
      email: user.email,
    });
    return { user: { id: user.id, email: user.email, role: user.role }, ...tokens };
  }

   @UseGuards(JwtAccessGuard)
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    // (validador ya aplica MinLength=8; aquí agregamos reglas extra si quieres)
    if (dto.currentPassword === dto.newPassword) {
      // Tu front mapea 400 -> 'invalidPassword'
      throw new BadRequestException('sameAsOld');
    }

    await this.auth.changePassword(user.sub, dto.currentPassword, dto.newPassword);
    return { message: 'passwordUpdated' };
  }
}
