import { IsInt, Min } from 'class-validator';

export class UpdateProjectLabelOrderDto {
  @IsInt()
  @Min(0)
  newIndex!: number;
}
