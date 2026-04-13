import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { TicketShareLinksService } from './ticket-share-links.service';
import { TicketShareLinksController } from './ticket-share-links.controller';
import { PublicTicketsService } from './public-tickets.service';
import { PublicTicketsController } from './public-tickets.controller';
import { TicketNotificationService } from './ticket-notification.service';
import { PrismaModule } from '../prisma/prisma.module';
import { GoogleCloudStorageModule } from '../google-cloud-storage/google-cloud-storage.module';
import { EmailModule } from 'src/email/email.module';

@Module({
  imports: [PrismaModule, GoogleCloudStorageModule, EmailModule],
  controllers: [TicketsController, TicketShareLinksController, PublicTicketsController],
  providers: [
    TicketsService,
    TicketShareLinksService,
    PublicTicketsService,
    TicketNotificationService,
  ],
  exports: [TicketsService, TicketShareLinksService, TicketNotificationService],
})
export class TicketsModule {}
