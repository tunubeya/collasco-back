import { IsOptional, IsString, MaxLength, IsBoolean, IsUUID } from 'class-validator';

export class UpdateModuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isRoot?: boolean;

  @IsOptional()
  @IsUUID()
  parentModuleId?: string | null;
}
