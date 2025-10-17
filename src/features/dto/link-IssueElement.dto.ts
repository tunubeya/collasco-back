import { IsArray, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { ReviewStatus } from '@prisma/client';

export class LinkIssueElementDto {
  @IsOptional() @IsUrl() githubIssueUrl?: string;
  @IsOptional() @IsUrl() pullRequestUrl?: string;

  // lista de commits SHA (o refs)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  commitHashes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string; // opcional: razon/nota

  @IsOptional()
  reviewStatus?: ReviewStatus;
}
