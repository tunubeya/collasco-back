import { IsOptional, IsString, MaxLength, IsUUID, IsBoolean } from 'class-validator';

export class CreateModuleDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUUID()
  parentModuleId?: string;

  @IsOptional()
  @IsBoolean()
  isRoot?: boolean;
}
