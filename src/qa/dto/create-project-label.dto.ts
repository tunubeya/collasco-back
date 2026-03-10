import { ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateProjectLabelDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @IsOptional()
  @IsBoolean()
  defaultNotApplicable?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  // roleIds que pueden ver el label (si vacío, visible para todos)
  visibleRoleIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  // roleIds que pueden ver pero no editar el label
  readOnlyRoleIds?: string[];
}
