import { Module } from '@nestjs/common';
import { GoogleCloudStorageService } from './google-cloud-storage.service';

@Module({
  providers: [GoogleCloudStorageService],
  exports: [GoogleCloudStorageService], // Exportar para usarlo en otros módulos
})
export class GoogleCloudStorageModule {}