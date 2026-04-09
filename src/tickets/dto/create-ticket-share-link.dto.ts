import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTicketShareLinkDto {
  @IsNotEmpty()
  @IsString()
  name!: string;
}
