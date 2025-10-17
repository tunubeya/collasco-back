import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SnapshotFeatureDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changelog?: string;
}
