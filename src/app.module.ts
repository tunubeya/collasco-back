import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { envValidationSchema } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { APP_GUARD } from '@nestjs/core';
import { JwtAccessGuard } from './auth/guards/jwt-access.guard';
import { RolesGuard } from './auth/roles.guard';
import { ProjectsModule } from './projects/projects.module';
import { ModulesModule } from './modules/modules.module';
import { FeaturesModule } from './features/features.module';
import { GithubModule } from './github/github.module';
import { QaModule } from './qa/qa.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      validationSchema: envValidationSchema,
    }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 120 },
      { name: 'auth', ttl: 60_000, limit: 10 }, // más estricto para auth
    ]),
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: false,
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss Z' } }
            : undefined,
      },
    }),
    HealthModule,
    PrismaModule,
    UsersModule,
    AuthModule,
    ProjectsModule,
    ModulesModule,
    FeaturesModule,
    GithubModule,
    QaModule,
    // aquí irán tus módulos de dominio (UsersModule, ProjectsModule, etc.)
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAccessGuard }, // auth primero
    { provide: APP_GUARD, useClass: RolesGuard }, // luego roles (si hay @Roles)
  ],
})
export class AppModule {}
