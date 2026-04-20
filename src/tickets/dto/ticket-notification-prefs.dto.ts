import { IsArray, IsUUID } from 'class-validator';

export class BulkAddTicketsNotifyDto {
  @IsArray()
  @IsUUID('4', { each: true })
  ticketIds!: string[];
}

export class BulkAddTicketsEmailDto {
  @IsArray()
  @IsUUID('4', { each: true })
  ticketIds!: string[];
}
