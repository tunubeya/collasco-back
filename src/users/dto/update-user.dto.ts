import { IsString, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @MaxLength(120)
  name!: string;
  @IsString()
  @MaxLength(120)
  email!: string;
}