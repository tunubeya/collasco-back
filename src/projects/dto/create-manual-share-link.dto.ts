import { IsArray, IsUUID } from 'class-validator';

export class CreateManualShareLinkDto {
  @IsArray()
  @IsUUID('4', { each: true })
  labelIds!: string[];
}
