import { ProjectMemberRole } from '@prisma/client';
import { ArrayUnique, IsArray, IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateProjectLabelDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @IsOptional()
  @IsBoolean()
  defaultNotApplicable?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(ProjectMemberRole, { each: true })
  visibleToRoles?: ProjectMemberRole[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(ProjectMemberRole, { each: true })
  readOnlyRoles?: ProjectMemberRole[];
}
