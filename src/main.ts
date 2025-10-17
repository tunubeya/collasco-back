import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import compression from 'compression';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Seguridad + perf
  app.use(helmet());
  app.use(compression());

  // CORS abierto (ajustable más adelante)
  app.enableCors({ origin: true, credentials: true });

  // Validación global
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new PrismaExceptionFilter());

  // Prefix de versión
  app.setGlobalPrefix('v1');
  const prisma = app.get(PrismaService);
  prisma.enableShutdownHooks(app);
  // Swagger
  const config = new DocumentBuilder()
    .setTitle('UMS API')
    .setDescription('Ultimate Management System API')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, doc);

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Server http://localhost:${port}/v1`);
  logger.log(`Swagger http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error('Fatal bootstrap error:', err);
  process.exit(1);
});
