import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { PublicController } from './public.controller';
import { ProjectsService } from './projects.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { GithubModule } from 'src/github/github.module';

@Module({
  imports: [PrismaModule, GithubModule],
  controllers: [ProjectsController, PublicController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
