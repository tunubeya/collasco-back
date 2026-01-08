import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateLinkedFeatureDto {
  @IsOptional()
  @IsUUID()
  targetFeatureId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}
