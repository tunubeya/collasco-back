import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { FeaturePriority, FeatureStatus } from '@prisma/client';

export class CreateFeatureDto {
  @IsString()
  @MaxLength(120)
  name!: string;

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
}
