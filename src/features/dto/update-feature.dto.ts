import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { FeaturePriority, FeatureStatus } from '@prisma/client';

export class UpdateFeatureDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(FeaturePriority)
  priority?: FeaturePriority;

  @IsOptional()
  @IsEnum(FeatureStatus)
  status?: FeatureStatus | null;

  @IsOptional()
  @IsUUID()
  moduleId?: string;
}
