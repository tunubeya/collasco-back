import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TestRunStatus } from '@prisma/client';
import { TestResultInput } from './create-test-run.dto';

export class CreateProjectTestRunDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  environment!: string;

  @IsOptional()
  @IsUUID()
  runById?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TestResultInput)
  results!: TestResultInput[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  targetTestCaseIds?: string[];

  @IsOptional()
  @IsEnum(TestRunStatus)
  status?: TestRunStatus;
}
