import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePublicTicketDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

export class CreatePublicSectionDto {
  @IsEnum(['RESPONSE', 'COMMENT'])
  @IsNotEmpty()
  type!: 'RESPONSE' | 'COMMENT';

  @IsString()
  @IsNotEmpty()
  content!: string;
}
