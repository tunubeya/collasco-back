import { Module } from '@nestjs/common';
import { QaController } from './qa.controller';
import { ProjectLabelsController } from './project-labels.controller';
import { QaService } from './qa.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [QaController, ProjectLabelsController],
  providers: [QaService],
})
export class QaModule {}
