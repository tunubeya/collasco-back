import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GithubService } from './github.service';
import { Public } from '../auth/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';
import { IsString, MinLength } from 'class-validator';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';

// DTO mínimo para conectar token (usuario o proyecto)
class ConnectGithubDto {
  @IsString()
  @MinLength(20)
  token!: string;
}

@UseGuards(JwtAccessGuard)
@Controller('github')
export class GithubController {
  constructor(private readonly gh: GithubService) {}
  // === (opcional) WHOAMI usando el token global (o sin token) ===
  @Public()
  @Get('whoami')
  whoAmI() {
    return this.gh.whoAmI(); // sin override => usa supertoken si existe
  }
  // === Identidad GitHub del USUARIO autenticado ===
  // Guarda/actualiza el token del usuario autenticado
  @Post('me/token')
  async connect(@CurrentUser() user: AccessTokenPayload, @Body() dto: ConnectGithubDto) {
    // valida el token hablando con GitHub
    console.log("github me token:", user, dto);
    
    const me = await this.gh.whoAmI({ tokenOverride: dto.token });
    // guarda el token para este user
    await this.gh.upsertUserToken(user.sub, dto.token, me?.login ?? undefined);
    return { ok: true, github: me };
  }
  // Elimina el token del usuario autenticado
  @Delete('me/token')
  async disconnect(@CurrentUser() user: AccessTokenPayload) {
    await this.gh.deleteUserToken(user.sub);
    return { ok: true };
  }
  // Consulta el estado con el token del usuario (si existe)
  @Get('me/whoami')
  async whoAmIWithUserToken(@CurrentUser() user: AccessTokenPayload) {
    const token = await this.gh.getUserToken(user.sub);
    if (!token) return { connected: false };
    const me = await this.gh.whoAmI({ tokenOverride: token });
    return { connected: true, github: me };
  }

  // === Credencial GitHub a nivel de PROYECTO (owner-only) ===

  // Guarda/actualiza token del proyecto (requiere ser owner del proyecto)
  @Post('projects/:id/token')
  async connectProjectToken(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) projectId: string,
    @Body() dto: ConnectGithubDto,
  ) {
    // valida el token contra GitHub
    const me = await this.gh.whoAmI({ tokenOverride: dto.token });
    await this.gh.upsertProjectTokenForOwner(user.sub, projectId, {
      accessToken: dto.token,
      username: me?.login,
    });
    return { ok: true, github: me };
  }

  // Elimina el token del proyecto (owner-only)
  @Delete('projects/:id/token')
  async disconnectProjectToken(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) projectId: string,
  ) {
    await this.gh.deleteProjectTokenForOwner(user.sub, projectId);
    return { ok: true };
  }

  // WHOAMI usando la resolución del proyecto (credencial del proyecto → token del usuario)
  @Get('projects/:id/whoami')
  async whoAmIForProject(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) projectId: string,
  ) {
    return this.gh.whoAmIForProject(user.sub, projectId);
  }
}
