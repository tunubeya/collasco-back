import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from 'src/auth/current-user.decorator';

import type { AccessTokenPayload } from '../auth/types/jwt-payload';
import { UpdateUserDto } from './dto/update-user.dto';

@UseGuards(JwtAccessGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Perfil del usuario autenticado
  @Get('me/profile')
  async me(@CurrentUser() user: AccessTokenPayload) {
    return this.usersService.getMe(user.sub);
  }

  // Actualización básica del usuario autenticado (name, etc.)
  @Patch('me')
  async updateMe(@CurrentUser() user: AccessTokenPayload, @Body() dto: UpdateUserDto) {
    return this.usersService.updateMe(user.sub, dto);
  }

  // Perfil por ID (admin/miembro autenticado con acceso a ese recurso, si lo restringes en service)
  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.usersService.getByIdOrThrow(id);
  }
}
