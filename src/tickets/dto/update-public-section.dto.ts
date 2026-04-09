import { IsString, IsNotEmpty } from 'class-validator';

export class UpdatePublicSectionDto {
  @IsString()
  @IsNotEmpty()
  content!: string;
}
