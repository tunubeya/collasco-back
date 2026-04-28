import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateTicketNotificationPrefsDto {
  @IsOptional()
  @IsBoolean()
  notifyAssignedTickets?: boolean;
  @IsOptional()
  @IsBoolean()
  notifyUnassignedTickets?: boolean;
  @IsOptional()
  @IsBoolean()
  emailAssignedTickets?: boolean;
  @IsOptional()
  @IsBoolean()
  emailUnassignedTickets?: boolean;
}