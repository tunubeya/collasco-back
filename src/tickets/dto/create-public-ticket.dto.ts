import { IsEmail, IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreatePublicTicketDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class CreatePublicSectionDto {
  @IsEnum(['RESPONSE', 'COMMENT'])
  @IsNotEmpty()
  type!: 'RESPONSE' | 'COMMENT';

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
