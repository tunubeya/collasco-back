import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { ProjectMemberRole } from '@prisma/client';

export class AddMemberDto {
  // Email del usuario que vas a agregar como miembro
  @IsEmail()
  email!: string;

  // Rol dentro del proyecto (default: DEVELOPER si no se envía)
  @IsOptional()
  @IsEnum(ProjectMemberRole)
  role?: ProjectMemberRole;
}
