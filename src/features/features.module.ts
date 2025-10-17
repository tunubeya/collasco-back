import { Module } from '@nestjs/common';
import { FeaturesController } from './features.controller';
import { FeaturesService } from './features.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { GithubModule } from 'src/github/github.module';
@Module({
  imports: [PrismaModule, GithubModule],
  controllers: [FeaturesController],
  providers: [FeaturesService],
  exports: [FeaturesService],
})
export class FeaturesModule {}
