import { DocumentationEntityType } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class ListManualShareLinksDto {
  @IsOptional()
  @IsEnum(DocumentationEntityType)
  scope?: DocumentationEntityType;

  @IsOptional()
  @IsUUID('4')
  rootId?: string;
}
