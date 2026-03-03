import { IsString, MinLength } from 'class-validator';

export class RenameDocumentationImageDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
