import { IsEnum } from 'class-validator';

export enum MoveDirection {
  UP = 'UP',
  DOWN = 'DOWN',
}

export class MoveOrderDto {
  @IsEnum(MoveDirection)
  direction!: MoveDirection;
}
