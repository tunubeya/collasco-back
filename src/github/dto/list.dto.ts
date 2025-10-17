// src/github/dto/list.dto.ts
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListIssuesDto {
  @IsOptional()
  @IsIn(['open', 'closed', 'all'])
  state: 'open' | 'closed' | 'all' = 'open';

  @IsOptional()
  @IsString()
  labels?: string; // "bug,help wanted"

  @IsOptional()
  @IsString()
  since?: string; // ISO date

  @IsOptional()
  @IsString()
  assignee?: string;

  @IsOptional()
  @Min(1)
  @Max(100)
  @IsInt()
  per_page = 50;

  @IsOptional()
  @Min(1)
  @IsInt()
  page = 1;
}

export class ListPullsDto {
  @IsOptional()
  @IsIn(['open', 'closed', 'all'])
  state: 'open' | 'closed' | 'all' = 'open';

  @IsOptional()
  @IsIn(['created', 'updated', 'popularity', 'long-running'])
  sort?: 'created' | 'updated' | 'popularity' | 'long-running';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction?: 'asc' | 'desc';

  @IsOptional()
  @Min(1)
  @Max(100)
  @IsInt()
  per_page = 50;

  @IsOptional()
  @Min(1)
  @IsInt()
  page = 1;
}
