import { TestEvaluation } from '@prisma/client';
import { ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class TestResultInput {
  @IsUUID()
  testCaseId!: string;

  @IsEnum(TestEvaluation)
  evaluation!: TestEvaluation;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class CreateTestRunDto {
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

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TestResultInput)
  results?: TestResultInput[];
}
