import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const toInt = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
};
export class PaginationDto {
  @IsOptional()
  @Transform(({ value }) => toInt(value))
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Transform(({ value }) => toInt(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  /**
   * Ejemplos:
   *   updatedAt  -> asc
   *   -updatedAt -> desc
   */
  @IsOptional()
  @IsString()
  sort?: string;

  /**
   * Búsqueda simple por nombre/descripcion
   */
  @IsOptional()
  @IsString()
  q?: string;
}
