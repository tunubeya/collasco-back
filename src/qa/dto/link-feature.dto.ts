import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class LinkFeatureDto {
  @IsUUID()
  targetFeatureId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
