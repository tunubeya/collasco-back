import { DocumentationEntityType } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateManualShareLinkDto {
  @IsArray()
  @IsUUID('4', { each: true })
  labelIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  @IsOptional()
  @IsEnum(DocumentationEntityType)
  rootType?: DocumentationEntityType;

  @IsOptional()
  @IsUUID('4')
  rootId?: string;
}
