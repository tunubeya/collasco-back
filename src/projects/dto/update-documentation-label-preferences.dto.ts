import { IsArray, IsUUID } from 'class-validator';

export class UpdateDocumentationLabelPreferencesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  labelIds!: string[];
}
