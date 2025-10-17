import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SnapshotModuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changelog?: string;
}
