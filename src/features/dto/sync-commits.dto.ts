import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class SyncCommitsDto {
  @IsOptional()
  @IsBoolean()
  append?: boolean = true;

  /**
   * Límite opcional para truncar la lista (p.ej. guardar solo los más recientes)
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}
