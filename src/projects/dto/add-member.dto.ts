import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ProjectMemberRole } from '@prisma/client';

export class AddMemberDto {
  // ID del usuario (User.id) que vas a agregar como miembro
  @IsString()
  userId!: string;

  // Rol dentro del proyecto (default: DEVELOPER si no se envía)
  @IsOptional()
  @IsEnum(ProjectMemberRole)
  role?: ProjectMemberRole;
}
