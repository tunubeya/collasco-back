import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';
import type { CreateModuleDto } from './dto/create-module.dto';
import type { UpdateModuleDto } from './dto/update-module.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { buildSort, clampPageLimit, like } from 'src/common/utils/pagination';
import { ProjectMemberRole } from '@prisma/client';

type Allowed = 'READ' | 'WRITE';
const READ_ROLES: ProjectMemberRole[] = ['OWNER', 'MAINTAINER', 'DEVELOPER', 'VIEWER'];
const WRITE_ROLES: ProjectMemberRole[] = ['OWNER', 'MAINTAINER'];


/** stringify estable + hash (sin archivo nuevo) */
import { createHash } from 'crypto';
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isUnknownArray(v: unknown): v is ReadonlyArray<unknown> {
  return Array.isArray(v);
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return JSON.stringify(value);
    case 'bigint':
      // JSON no soporta BigInt; lo normalizamos a string
      return JSON.stringify(value.toString());
    case 'undefined':
      // Evita que JSON.stringify devuelva undefined a nivel raíz
      return 'null';
    case 'symbol':
      // Normaliza símbolo (no serializable) a string estable
      return JSON.stringify(value.toString());
    case 'object':
      break; // seguimos abajo
    default:
      return JSON.stringify(value as never);
  }

  if (isUnknownArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }

  if (!isRecord(value)) {
    return JSON.stringify(value);
  }

  const keys = Object.keys(value).sort();
  let out = '{';
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]; // <- sin "!"
    const v = value[k]; // <- ya es Record<string, unknown>
    out += `${JSON.stringify(k)}:${stableStringify(v)}`;
    if (i !== keys.length - 1) out += ',';
  }
  out += '}';
  return out;
}
function contentHashOf(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

// Reutilizamos tipos del project
type TreeFeatureNode = {
  type: 'feature';
  id: string;
  moduleId: string;
  name: string;
  status: import('@prisma/client').FeatureStatus;
  priority: import('@prisma/client').FeaturePriority | null;
  sortOrder: number | null;
  order: number;
  createdAt: Date;
  publishedVersionId: string | null;
};

export type TreeModuleNode = {
  type: 'module';
  id: string;
  name: string;
  parentModuleId: string | null;
  isRoot: boolean;
  sortOrder: number | null;
  order: number;
  createdAt: Date;
  publishedVersionId: string | null;
  items: (TreeModuleNode | TreeFeatureNode)[];
};

type ModuleRow = {
  id: string;
  projectId: string;
  name: string;
  parentModuleId: string | null;
  isRoot: boolean;
  sortOrder: number | null;
  createdAt: Date;
  publishedVersionId: string | null;
};

type FeatureRow = {
  id: string;
  moduleId: string;
  name: string;
  status: import('@prisma/client').FeatureStatus;
  priority: import('@prisma/client').FeaturePriority | null;
  sortOrder: number | null;
  createdAt: Date;
  publishedVersionId: string | null;
};
@Injectable()
export class ModulesService {
  constructor(private readonly prisma: PrismaService) {}



  // ===== Helpers de autorización (sin archivos nuevos) =====
  private async requireProjectRole(userId: string, projectId: string, allowed: Allowed) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    if (project.ownerId === userId) return { role: 'OWNER' as const };

    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    if (!membership) throw new ForbiddenException('Not a project member');

    const roles = allowed === 'READ' ? READ_ROLES : WRITE_ROLES;
    if (!roles.includes(membership.role)) throw new ForbiddenException('Insufficient role');
    return membership;
  }

  private async requireModule(user: AccessTokenPayload, moduleId: string, allowed: Allowed) {
    const mod = await this.prisma.module.findUnique({
      where: { id: moduleId },
      select: { id: true, projectId: true },
    });
    if (!mod) throw new NotFoundException('Module not found');
    await this.requireProjectRole(user.sub, mod.projectId, allowed);
    return mod;
  }

async getModuleStructure(user: AccessTokenPayload, moduleId: string) {
    const mod = await this.requireModule(user, moduleId, 'READ'); // ya valida rol y devuelve { id, projectId }

    // Traemos TODO el universo del proyecto (módulos + features) para poder construir el subárbol
    const [modules, features] = await this.prisma.$transaction([
      this.prisma.module.findMany({
        where: { projectId: mod.projectId },
        select: {
          id: true,
          projectId: true,
          name: true,
          parentModuleId: true,
          isRoot: true,
          sortOrder: true,
          createdAt: true,
          publishedVersionId: true,
        },
      }),
      this.prisma.feature.findMany({
        where: { module: { projectId: mod.projectId } },
        select: {
          id: true,
          moduleId: true,
          name: true,
          status: true,
          priority: true,
          sortOrder: true,
          createdAt: true,
          publishedVersionId: true,
        },
      }),
    ]);

    // Mapas por padre/módulo
    const modulesByParent = new Map<string | null, ModuleRow[]>();
    const featuresByModule = new Map<string, FeatureRow[]>();

    for (const m of modules) {
      const key = m.parentModuleId ?? null;
      const list = modulesByParent.get(key) ?? [];
      list.push(m);
      modulesByParent.set(key, list);
    }
    for (const f of features) {
      const list = featuresByModule.get(f.moduleId) ?? [];
      list.push(f);
      featuresByModule.set(f.moduleId, list);
    }

    const sortChildren = (
      a:
        | { type: 'module'; value: ModuleRow }
        | { type: 'feature'; value: FeatureRow },
      b:
        | { type: 'module'; value: ModuleRow }
        | { type: 'feature'; value: FeatureRow }
    ) => {
      const orderA = (a.value.sortOrder ?? Number.MAX_SAFE_INTEGER);
      const orderB = (b.value.sortOrder ?? Number.MAX_SAFE_INTEGER);
      if (orderA !== orderB) return orderA - orderB;

      const timeA = a.value.createdAt.getTime();
      const timeB = b.value.createdAt.getTime();
      if (timeA !== timeB) return timeA - timeB;

      if (a.type !== b.type) return a.type === 'module' ? -1 : 1;

      return a.value.name.localeCompare(b.value.name);
    };

    const buildNode = (m: ModuleRow): TreeModuleNode => {
      const childMods = modulesByParent.get(m.id) ?? [];
      const feats = featuresByModule.get(m.id) ?? [];

      const combined:
        | { type: 'module'; value: ModuleRow }[]
        | { type: 'feature'; value: FeatureRow }[] = [
        ...childMods.map((c) => ({ type: 'module' as const, value: c })),
        ...feats.map((f) => ({ type: 'feature' as const, value: f })),
      ] as any;

      (combined as any[]).sort(sortChildren);

      const items = (combined as any[]).map((entry, idx) => {
        if (entry.type === 'module') {
          const child = buildNode(entry.value);
          child.order = idx + 1;
          return child;
        } else {
          const f = entry.value as FeatureRow;
          const node: TreeFeatureNode = {
            type: 'feature',
            id: f.id,
            moduleId: f.moduleId,
            name: f.name,
            status: f.status,
            priority: f.priority,
            sortOrder: f.sortOrder ?? null,
            order: idx + 1,
            createdAt: f.createdAt,
            publishedVersionId: f.publishedVersionId,
          };
          return node;
        }
      });

      const node: TreeModuleNode = {
        type: 'module',
        id: m.id,
        name: m.name,
        parentModuleId: m.parentModuleId,
        isRoot: m.isRoot,
        sortOrder: m.sortOrder ?? null,
        order: 0, // lo seteamos afuera si hace falta
        createdAt: m.createdAt,
        publishedVersionId: m.publishedVersionId,
        items,
      };
      return node;
    };

    const rootRow = modules.find((x) => x.id === moduleId);
    if (!rootRow) throw new NotFoundException('Module not found');

    const rootNode = buildNode(rootRow);
    rootNode.order = 1;

    return {
      projectId: mod.projectId,
      moduleId,
      node: rootNode,
    };
  }
  // ===== CRUD dentro del proyecto =====
  async createInProject(user: AccessTokenPayload, projectId: string, dto: CreateModuleDto) {
    await this.requireProjectRole(user.sub, projectId, 'WRITE');

    // Validar parent perteneciente al mismo proyecto
    if (dto.parentModuleId) {
      const parent = await this.prisma.module.findUnique({ where: { id: dto.parentModuleId } });
      if (!parent || parent.projectId !== projectId) {
        throw new ForbiddenException('Invalid parentModuleId');
      }
    }

    let nextOrder: number;

    if (dto.parentModuleId) {
      const [moduleMax, featureMax] = await this.prisma.$transaction([
        this.prisma.module.aggregate({
          _max: { sortOrder: true },
          where: { parentModuleId: dto.parentModuleId },
        }),
        this.prisma.feature.aggregate({
          _max: { sortOrder: true },
          where: { moduleId: dto.parentModuleId },
        }),
      ]);
      const highest = Math.max(
        moduleMax._max.sortOrder ?? -1,
        featureMax._max.sortOrder ?? -1,
      );
      nextOrder = highest + 1;
    } else {
      const moduleMax = await this.prisma.module.aggregate({
        _max: { sortOrder: true },
        where: { projectId, parentModuleId: null },
      });
      nextOrder = (moduleMax._max.sortOrder ?? -1) + 1;
    }

    return this.prisma.module.create({
      data: {
        projectId,
        parentModuleId: dto.parentModuleId ?? null,
        name: dto.name,
        description: dto.description ?? null,
        isRoot: !!dto.isRoot,
        sortOrder: nextOrder,
        lastModifiedById: user.sub,
      },
    });
  }

  async listInProject(
    user: AccessTokenPayload,
    projectId: string,
    parentModuleId?: string | null,
    query?: PaginationDto,
  ) {
    await this.requireProjectRole(user.sub, projectId, 'READ');

    const { page, take, skip } = clampPageLimit(query?.page, query?.limit);
    const orderBy = buildSort(query?.sort) ?? [
      { sortOrder: 'asc' as const },
      { createdAt: 'asc' as const },
    ];
    const text = like(query?.q);

    const base = {
      projectId,
      ...(parentModuleId !== undefined ? { parentModuleId } : {}),
    };
    const textFilter = text ? { OR: [{ name: text }, { description: text }] } : undefined;
    const where = textFilter ? { AND: [base, textFilter] } : base;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.module.findMany({ where, skip, take, orderBy }),
      this.prisma.module.count({ where }),
    ]);
    return { items, total, page, limit: take };
  }

  async getOne(user: AccessTokenPayload, moduleId: string) {
    await this.requireModule(user, moduleId, 'READ');
    return this.prisma.module.findUnique({
      where: { id: moduleId },
      include: {
        versions: {
          select: {
            id: true,
            versionNumber: true,
            changelog: true,
            createdAt: true,
            isRollback: true,
            createdById: true,
          },
          orderBy: { versionNumber: 'desc' },
        },
        publishedVersion: { select: { id: true, versionNumber: true } },
      },
    });
  }

  async update(user: AccessTokenPayload, moduleId: string, dto: UpdateModuleDto) {
    await this.requireModule(user, moduleId, 'WRITE');
    return this.prisma.module.update({
      where: { id: moduleId },
      data: {
        name: dto.name ?? undefined,
        description: dto.description ?? undefined,
        isRoot: dto.isRoot ?? undefined,
        lastModifiedById: user.sub,
      },
    });
  }

  // ===== Versionado =====

  /** Calcula payload, hash y crea snapshot si no existe (dedupe por contentHash). */
  private async snapshotInternal(
    moduleId: string,
    userId: string,
    changelog?: string,
    asRollback?: boolean,
  ) {
    // estado actual + pins de hijos/features publicados
    const mod = await this.prisma.module.findUnique({
      where: { id: moduleId },
      include: {
        children: { select: { id: true, publishedVersionId: true } },
        features: { select: { id: true, publishedVersionId: true } },
      },
    });
    if (!mod) throw new NotFoundException('Module not found');

    // Resolver versionNumbers desde los IDs publicados
    const childVerIds = mod.children.map((c) => c.publishedVersionId).filter(Boolean) as string[];
    const featVerIds = mod.features.map((f) => f.publishedVersionId).filter(Boolean) as string[];

    const [childVers, featVers] = await this.prisma.$transaction(async (tx) => {
      const childVers = childVerIds.length
        ? await tx.moduleVersion.findMany({
            where: { id: { in: childVerIds } },
            select: { moduleId: true, versionNumber: true },
          })
        : [];

      const featVers = featVerIds.length
        ? await tx.featureVersion.findMany({
            where: { id: { in: featVerIds } },
            select: { featureId: true, versionNumber: true },
          })
        : [];

      return [childVers, featVers] as const;
    });

    const childrenPins = childVers.map((v) => ({
      moduleId: v.moduleId,
      versionNumber: v.versionNumber,
    }));
    const featurePins = featVers.map((v) => ({
      featureId: v.featureId,
      versionNumber: v.versionNumber,
    }));

    const payloadForHash = {
      name: mod.name,
      description: mod.description ?? null,
      parentModuleId: mod.parentModuleId ?? null,
      isRoot: mod.isRoot,
      childrenPins,
      featurePins,
    };
    const hash = contentHashOf(payloadForHash);

    return this.prisma.$transaction(async (tx) => {
      // dedupe por hash
      const existing = await tx.moduleVersion.findUnique({
        where: { moduleId_contentHash: { moduleId: mod.id, contentHash: hash } },
        select: { id: true, versionNumber: true },
      });
      if (existing) return existing;

      const last = await tx.moduleVersion.findFirst({
        where: { moduleId: mod.id },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const next = (last?.versionNumber ?? 0) + 1;

      return tx.moduleVersion.create({
        data: {
          moduleId: mod.id,
          versionNumber: next,
          name: mod.name,
          description: mod.description ?? null,
          parentModuleId: mod.parentModuleId ?? null,
          isRoot: mod.isRoot,
          changelog: changelog ?? null,
          childrenPins,
          featurePins,
          createdById: userId,
          isRollback: !!asRollback,
          contentHash: hash,
        },
        select: { id: true, versionNumber: true },
      });
    });
  }

  async snapshot(user: AccessTokenPayload, moduleId: string, changelog?: string) {
    await this.requireModule(user, moduleId, 'WRITE');
    return this.snapshotInternal(moduleId, user.sub, changelog, false);
  }

  async rollback(
    user: AccessTokenPayload,
    moduleId: string,
    versionNumber: number,
    changelog?: string,
  ) {
    await this.requireModule(user, moduleId, 'WRITE');

    const ver = await this.prisma.moduleVersion.findUnique({
      where: { moduleId_versionNumber: { moduleId, versionNumber } },
      select: { name: true, description: true, parentModuleId: true, isRoot: true },
    });
    if (!ver) throw new NotFoundException('Module version not found');

    // 1) actualizar el módulo al estado de esa versión
    await this.prisma.module.update({
      where: { id: moduleId },
      data: {
        name: ver.name ?? undefined,
        description: ver.description ?? null,
        parentModuleId: ver.parentModuleId ?? null,
        isRoot: ver.isRoot ?? false,
        lastModifiedById: user.sub,
      },
    });

    // 2) snapshot (marcado rollback, dedupe si ya existía)
    const res = await this.snapshotInternal(
      moduleId,
      user.sub,
      changelog ?? `Rollback to v${versionNumber}`,
      true,
    );
    return res;
  }

  async publish(user: AccessTokenPayload, moduleId: string, versionNumber: number) {
    await this.requireModule(user, moduleId, 'WRITE');

    const ver = await this.prisma.moduleVersion.findUnique({
      where: { moduleId_versionNumber: { moduleId, versionNumber } },
      select: { id: true },
    });
    if (!ver) throw new NotFoundException('Module version not found');

    await this.prisma.module.update({
      where: { id: moduleId },
      data: { publishedVersionId: ver.id, lastModifiedById: user.sub },
    });
    return { ok: true };
  }

  async listVersions(user: AccessTokenPayload, moduleId: string) {
    await this.requireModule(user, moduleId, 'READ');
    return this.prisma.moduleVersion.findMany({
      where: { moduleId },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        changelog: true,
        createdAt: true,
        isRollback: true,
        createdBy: { select: { id: true, email: true, name: true } },
      },
    });
  }

  async delete(
    user: AccessTokenPayload,
    moduleId: string,
    opts: { cascade?: boolean; force?: boolean } = {},
  ) {
    const { cascade = false, force = false } = opts;

    const mod = await this.prisma.module.findUnique({
      where: { id: moduleId },
      include: {
        project: { select: { id: true, ownerId: true } },
        _count: { select: { children: true, features: true } },
      },
    });

    if (!mod) throw new NotFoundException('Module not found');

    // ⛳ auth: OWNER/MAINTAINER del proyecto (ajusta a tu esquema real)
    // await this.assertCanMutateProject(user, mod.project.id, ['OWNER', 'MAINTAINER']);

    if (!cascade && (mod._count.children > 0 || mod._count.features > 0)) {
      throw new ConflictException(
        'Module has children/features. Use ?cascade=true to delete subtree.',
      );
    }

    // Recolectar todo el subárbol (moduleId + descendientes)
    const allModuleIds = await this.collectModuleSubtreeIds(moduleId);

    // Si no force, valida que nada publicado exista en el subárbol
    if (!force) {
      const publishedModuleCount = await this.prisma.module.count({
        where: { id: { in: allModuleIds }, NOT: { publishedVersionId: null } },
      });
      const publishedFeatureCount = await this.prisma.feature.count({
        where: { moduleId: { in: allModuleIds }, NOT: { publishedVersionId: null } },
      });
      if (publishedModuleCount > 0 || publishedFeatureCount > 0) {
        throw new ConflictException(
          'There are published modules/features in the subtree. Use ?force=true.',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // 1) Borra IssueElements de todas las features del subárbol
      await tx.issueElement.deleteMany({
        where: { feature: { moduleId: { in: allModuleIds } } },
      });

      // 2) Borra FeatureVersions del subárbol
      await tx.featureVersion.deleteMany({
        where: { feature: { moduleId: { in: allModuleIds } } },
      });

      // 3) Borra Features del subárbol
      await tx.feature.deleteMany({
        where: { moduleId: { in: allModuleIds } },
      });

      // 4) Borra ModuleVersions del subárbol
      await tx.moduleVersion.deleteMany({
        where: { moduleId: { in: allModuleIds } },
      });

      // 5) Borra los Modules (cierra de raíz o en bloque; DB se encarga de SetNull en parent)
      await tx.module.deleteMany({
        where: { id: { in: allModuleIds } },
      });
    });

    return { ok: true, deletedModuleIds: allModuleIds };
  }

  /**
   * BFS para obtener todos los ids (incluye el root moduleId).
   */
  private async collectModuleSubtreeIds(rootId: string): Promise<string[]> {
    const result: string[] = [];
    let frontier: string[] = [rootId];

    while (frontier.length > 0) {
      result.push(...frontier);

      // fetch children de esta capa
      const children = await this.prisma.module.findMany({
        where: { parentModuleId: { in: frontier } },
        select: { id: true },
      });

      frontier = children.map((c) => c.id);
    }
    // El orden no importa porque borramos por deleteMany; si quisieras borrar hoja→raíz una a una,
    // podrías invertir y hacer deletes secuenciales.
    return Array.from(new Set(result));
  }

  /** Devuelve el árbol publicado resolviendo childrenPins/featurePins recursivamente. */
  // async getPublishedTree(user: AccessTokenPayload, moduleId: string) {
  //   // Permisos de lectura por proyecto
  //   await this.requireModule(user, moduleId, 'READ');

  //   return this.prisma.$transaction(async (tx) => {
  //     const root = await tx.module.findUnique({
  //       where: { id: moduleId },
  //       select: {
  //         id: true,
  //         publishedVersion: {
  //           select: { versionNumber: true },
  //         },
  //       },
  //     });
  //     if (!root || !root.publishedVersion) {
  //       throw new NotFoundException('Module has no published version');
  //     }

  //     // Función recursiva que resuelve una versión concreta de un módulo
  //     const build = async (mid: string, vnum: number): Promise<PublishedModuleNode> => {
  //       const mv = await tx.moduleVersion.findUnique({
  //         where: { moduleId_versionNumber: { moduleId: mid, versionNumber: vnum } },
  //         select: {
  //           moduleId: true,
  //           versionNumber: true,
  //           name: true,
  //           description: true,
  //           isRoot: true,
  //           childrenPins: true,
  //           featurePins: true,
  //         },
  //       });
  //       if (!mv) throw new NotFoundException('Module version not found');

  //       type ChildPin = { moduleId: string; versionNumber: number };
  //       type FeaturePin = { featureId: string; versionNumber: number };

  //       const childPins: ChildPin[] = (mv.childrenPins as unknown as ChildPin[]) ?? [];
  //       const featPins: FeaturePin[] = (mv.featurePins as unknown as FeaturePin[]) ?? [];

  //       // Resolver features (consulta por pin; precisión > performance, que suele ser OK)
  //       const features: PublishedFeatureNode[] = [];
  //       for (const pin of featPins) {
  //         const fv = await tx.featureVersion.findUnique({
  //           where: {
  //             featureId_versionNumber: {
  //               featureId: pin.featureId,
  //               versionNumber: pin.versionNumber,
  //             },
  //           },
  //           select: {
  //             featureId: true,
  //             versionNumber: true,
  //             name: true,
  //             description: true,
  //             priority: true,
  //             status: true,
  //           },
  //         });
  //         if (!fv) {
  //           // si un pin no existe, puedes lanzar o ignorar; elegimos lanzar para mantener integridad
  //           throw new NotFoundException(
  //             `Feature version not found for featureId=${pin.featureId} v${pin.versionNumber}`,
  //           );
  //         }
  //         features.push(fv);
  //       }

  //       // Resolver hijos recursivamente
  //       const children: PublishedModuleNode[] = [];
  //       for (const pin of childPins) {
  //         children.push(await build(pin.moduleId, pin.versionNumber));
  //       }

  //       return {
  //         moduleId: mv.moduleId,
  //         versionNumber: mv.versionNumber,
  //         name: mv.name ?? null,
  //         description: mv.description ?? null,
  //         isRoot: mv.isRoot ?? null,
  //         children,
  //         features,
  //       };
  //     };

  //     return build(root.id, root.publishedVersion.versionNumber);
  //   });
  // }
  // async move(
  //   user: AccessTokenPayload,
  //   moduleId: string,
  //   dto: { parentModuleId?: string | null; sortOrder?: number },
  // ) {
  //   // Requiere permiso de escritura
  //   const mod = await this.requireModule(user, moduleId, 'WRITE');

  //   // Determinar nuevo padre (si viene en el body)
  //   let targetParentId = mod.parentModuleId; // por defecto, no cambia
  //   const parentWasProvided = Object.prototype.hasOwnProperty.call(dto, 'parentModuleId');

  //   if (parentWasProvided) {
  //     targetParentId = dto.parentModuleId ?? null;

  //     if (targetParentId) {
  //       const parent = await this.prisma.module.findUnique({
  //         where: { id: targetParentId },
  //         select: { id: true, projectId: true, parentModuleId: true },
  //       });
  //       if (!parent) throw new NotFoundException('Target parent not found');
  //       if (parent.projectId !== mod.projectId) {
  //         throw new ForbiddenException('Parent must belong to the same project');
  //       }
  //       // Evitar ciclos: no puedes mover bajo un descendiente tuyo
  //       let cursor: string | null | undefined = targetParentId;
  //       while (cursor) {
  //         if (cursor === moduleId) {
  //           throw new BadRequestException('Cannot move a module under its own descendant');
  //         }
  //         const up = await this.prisma.module.findUnique({
  //           where: { id: cursor },
  //           select: { parentModuleId: true },
  //         });
  //         cursor = up?.parentModuleId ?? null;
  //       }
  //     }
  //   }

  //   // Determinar sortOrder (si no dan, lo colocamos al final entre hermanos del nuevo padre)
  //   let targetSortOrder = dto.sortOrder;
  //   if (targetSortOrder === undefined || targetSortOrder === null) {
  //     const siblingMax = await this.prisma.module.aggregate({
  //       _max: { sortOrder: true },
  //       where: { projectId: mod.projectId, parentModuleId: targetParentId ?? null },
  //     });
  //     targetSortOrder = (siblingMax._max.sortOrder ?? -1) + 1;
  //   }

  //   // Actualizar registro
  //   const updated = await this.prisma.module.update({
  //     where: { id: moduleId },
  //     data: {
  //       parentModuleId: parentWasProvided ? (targetParentId ?? null) : undefined,
  //       sortOrder: targetSortOrder,
  //       lastModifiedById: user.sub,
  //     },
  //     select: { id: true, parentModuleId: true, sortOrder: true },
  //   });

  //   return { ok: true, module: updated };
  // }
}
