import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { PrismaModule } from '../prisma/prisma.module';
import { GoogleCloudStorageModule } from '../google-cloud-storage/google-cloud-storage.module';

@Module({
  imports: [PrismaModule, GoogleCloudStorageModule],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
