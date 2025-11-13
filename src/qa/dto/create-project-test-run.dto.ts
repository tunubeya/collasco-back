import { ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
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
}

