import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { TicketShareLinksService } from './ticket-share-links.service';
import { TicketShareLinksController } from './ticket-share-links.controller';
import { PublicTicketsService } from './public-tickets.service';
import { PublicTicketsController } from './public-tickets.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { GoogleCloudStorageModule } from '../google-cloud-storage/google-cloud-storage.module';

@Module({
  imports: [PrismaModule, GoogleCloudStorageModule],
  controllers: [TicketsController, TicketShareLinksController, PublicTicketsController],
  providers: [TicketsService, TicketShareLinksService, PublicTicketsService],
  exports: [TicketsService, TicketShareLinksService],
})
export class TicketsModule {}
