import { Module } from '@nestjs/common';
import { QaController } from './qa.controller';
import { ProjectLabelsController } from './project-labels.controller';
import { DocumentationController } from './documentation.controller';
import { QaService } from './qa.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [QaController, ProjectLabelsController, DocumentationController],
  providers: [QaService],
})
export class QaModule {}
