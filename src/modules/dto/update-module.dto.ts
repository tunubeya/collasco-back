import { IsOptional, IsString, MaxLength, IsBoolean } from 'class-validator';

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
}
