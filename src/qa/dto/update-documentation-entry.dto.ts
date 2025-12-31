import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDocumentationEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;

  @IsOptional()
  @IsBoolean()
  isNotApplicable?: boolean;
}
