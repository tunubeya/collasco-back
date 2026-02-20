import { IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateManualShareLinkDto {
  @IsArray()
  @IsUUID('4', { each: true })
  labelIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
