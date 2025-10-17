// añade solo si no los tienes ya
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class MoveModuleDto {
  // Nuevo padre: UUID, null (subir a raíz) o undefined (no cambiar)
  @IsOptional()
  @IsUUID()
  parentModuleId?: string | null;

  // Posición entre hermanos (si no se envía, se mueve al final)
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
