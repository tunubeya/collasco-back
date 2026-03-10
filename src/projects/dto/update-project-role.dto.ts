import { PartialType } from '@nestjs/mapped-types';
import { CreateProjectRoleDto } from './create-project-role.dto';

export class UpdateProjectRoleDto extends PartialType(CreateProjectRoleDto) {}
