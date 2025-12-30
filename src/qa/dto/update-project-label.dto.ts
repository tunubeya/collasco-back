import { PartialType } from '@nestjs/mapped-types';
import { CreateProjectLabelDto } from './create-project-label.dto';

export class UpdateProjectLabelDto extends PartialType(CreateProjectLabelDto) {}
