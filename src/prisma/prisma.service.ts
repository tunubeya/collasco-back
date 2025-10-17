import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  // No hace falta async si no hacemos await adentro
  enableShutdownHooks(app: INestApplication): void {
    // process.on espera un callback sync; usamos void para marcar que ignoramos la promesa
    process.on('beforeExit', () => {
      void app.close();
    });
  }
}
