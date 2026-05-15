import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { AppEnv } from '../config/env.types';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor(config: ConfigService<AppEnv, true>) {
    super({
      transactionOptions: {
        maxWait: 5000,
        timeout: 15000,
      },
    });
  }

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
