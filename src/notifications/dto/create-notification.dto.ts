import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum NotificationType {
  INFO = 'INFO',
  SUCCESS = 'SUCCESS',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}

export class CreateNotificationDto {
  @ValidateIf((o) => !o.projectId && !o.scope && !o.userIds?.length)
  @IsUUID()
  @IsNotEmpty()
  userId?: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsOptional()
  data?: Record<string, unknown>;
}

export class CreateUserNotificationDto {
  @ValidateIf((o) => !o.email)
  @IsUUID()
  @IsNotEmpty()
  userId?: string;

  @ValidateIf((o) => !o.userId)
  @IsEmail()
  @IsNotEmpty()
  email?: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsOptional()
  data?: Record<string, unknown>;
}

export class CreateProjectNotificationDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsOptional()
  data?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleNames?: string[];
}

export class CreateBulkNotificationDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsOptional()
  data?: Record<string, unknown>;
}
