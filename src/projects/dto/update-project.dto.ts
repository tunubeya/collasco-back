import { IsEnum, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { ProjectStatus, Visibility } from '@prisma/client';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
  @IsString()
    @IsOptional()
  @MaxLength(120)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @IsOptional()
  @IsUrl()
  repositoryUrl?: string;
}
