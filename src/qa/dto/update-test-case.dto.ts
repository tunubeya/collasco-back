import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateTestCaseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  steps?: string;

  @IsOptional()
  @IsString()
  expected?: string;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

