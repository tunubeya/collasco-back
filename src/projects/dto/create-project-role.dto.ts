import { ArrayUnique, IsArray, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { PERMISSION_KEYS } from '../permissions';

const PERMISSION_VALUES = Object.values(PERMISSION_KEYS);

export class CreateProjectRoleDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSION_VALUES, { each: true })
  permissionKeys!: string[];
}
