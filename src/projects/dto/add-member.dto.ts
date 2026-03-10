import { IsEmail, IsOptional, IsUUID } from 'class-validator';

export class AddMemberDto {
  // Email del usuario que vas a agregar como miembro
  @IsEmail()
  email!: string;

  // Rol dentro del proyecto (roleId). Si no se envía, usa el rol default.
  @IsOptional()
  @IsUUID()
  roleId?: string;
}
