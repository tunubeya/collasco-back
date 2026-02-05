import {
  BadRequestException,
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
import { DocumentationEntityType, Prisma, ProjectMemberRole } from '@prisma/client';
import { MoveDirection } from 'src/common/dto/move-order.dto';

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
  status: import('@prisma/client').FeatureStatus | null;
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
  status: import('@prisma/client').FeatureStatus | null;
  priority: import('@prisma/client').FeaturePriority | null;
  sortOrder: number | null;
  createdAt: Date;
  publishedVersionId: string | null;
};

type OrderNeighbor = {
  type: 'module' | 'feature';
  id: string;
  sortOrder: number | null;
};
@Injectable()
export class ModulesService {
  constructor(private readonly prisma: PrismaService) {}



  // ===== Helpers de autorización (sin archivos nuevos) =====
  private async requireProjectRole(userId: string, projectId: string, allowed: Allowed) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
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
    const mod = await this.prisma.module.findFirst({
      where: { id: moduleId, deletedAt: null },
      select: { id: true, projectId: true, parentModuleId: true, sortOrder: true },
    });
    if (!mod) throw new NotFoundException('Module not found');
    await this.requireProjectRole(user.sub, mod.projectId, allowed);
    return mod;
  }

  private async nextModuleSortOrder(
    projectId: string,
    parentModuleId: string | null,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    if (parentModuleId) {
      const [moduleMax, featureMax] = await Promise.all([
        client.module.aggregate({
          _max: { sortOrder: true },
          where: { parentModuleId, deletedAt: null },
        }),
        client.feature.aggregate({
          _max: { sortOrder: true },
          where: { moduleId: parentModuleId, deletedAt: null },
        }),
      ]);
      return Math.max(moduleMax._max.sortOrder ?? -1, featureMax._max.sortOrder ?? -1) + 1;
    }

    const moduleMax = await client.module.aggregate({
      _max: { sortOrder: true },
      where: { projectId, parentModuleId: null, deletedAt: null },
    });
    return (moduleMax._max.sortOrder ?? -1) + 1;
  }

  private async compactOrdersAfterModuleMove(
    tx: Prisma.TransactionClient,
    projectId: string,
    parentModuleId: string | null,
    removedOrder: number | null,
  ) {
    if (removedOrder === null) return;
    await tx.module.updateMany({
      where: { projectId, parentModuleId, sortOrder: { gt: removedOrder }, deletedAt: null },
      data: { sortOrder: { decrement: 1 } },
    });
    if (parentModuleId) {
      await tx.feature.updateMany({
        where: { moduleId: parentModuleId, sortOrder: { gt: removedOrder }, deletedAt: null },
        data: { sortOrder: { decrement: 1 } },
      });
    }
  }

  private pickNeighbor(
    direction: MoveDirection,
    candidates: OrderNeighbor[],
  ): OrderNeighbor | null {
    if (!candidates.length) return null;
    return candidates.reduce<OrderNeighbor | null>((best, candidate) => {
      if (!best) return candidate;
      const bestValue =
        best.sortOrder ??
        (direction === MoveDirection.UP ? Number.MIN_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);
      const candidateValue =
        candidate.sortOrder ??
        (direction === MoveDirection.UP ? Number.MIN_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);
      if (direction === MoveDirection.UP) {
        return candidateValue > bestValue ? candidate : best;
      }
      return candidateValue < bestValue ? candidate : best;
    }, null);
  }

  private async findNeighborForModule(
    moduleId: string,
    projectId: string,
    parentModuleId: string | null,
    currentOrder: number,
    direction: MoveDirection,
  ): Promise<OrderNeighbor | null> {
    const orderFilter =
      direction === MoveDirection.UP ? { lt: currentOrder } : { gt: currentOrder };
    const orderBy = { sortOrder: direction === MoveDirection.UP ? 'desc' : 'asc' } as const;

    const moduleWhere = {
      projectId,
      parentModuleId,
      id: { not: moduleId },
      sortOrder: orderFilter,
      deletedAt: null,
    };

    const moduleNeighborPromise = this.prisma.module.findFirst({
      where: moduleWhere,
      orderBy,
      select: { id: true, sortOrder: true },
    });

    const featureNeighborPromise = parentModuleId
      ? this.prisma.feature.findFirst({
          where: { moduleId: parentModuleId, sortOrder: orderFilter, deletedAt: null },
          orderBy,
          select: { id: true, sortOrder: true },
        })
      : Promise.resolve(null);

    const [moduleNeighbor, featureNeighbor] = await Promise.all([
      moduleNeighborPromise,
      featureNeighborPromise,
    ]);

    const candidates: OrderNeighbor[] = [];
    if (moduleNeighbor) {
      candidates.push({
        type: 'module',
        id: moduleNeighbor.id,
        sortOrder: moduleNeighbor.sortOrder,
      });
    }
    if (featureNeighbor) {
      candidates.push({
        type: 'feature',
        id: featureNeighbor.id,
        sortOrder: featureNeighbor.sortOrder,
      });
    }
    return this.pickNeighbor(direction, candidates);
  }

  async getModuleStructure(user: AccessTokenPayload, moduleId: string) {
    const mod = await this.requireModule(user, moduleId, 'READ'); // ya valida rol y devuelve { id, projectId }

    // Traemos TODO el universo del proyecto (módulos + features) para poder construir el subárbol
    const [modules, features] = await this.prisma.$transaction([
      this.prisma.module.findMany({
        where: { projectId: mod.projectId, deletedAt: null },
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
        where: { module: { projectId: mod.projectId, deletedAt: null }, deletedAt: null },
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
      const parent = await this.prisma.module.findFirst({
        where: { id: dto.parentModuleId, deletedAt: null },
      });
      if (!parent || parent.projectId !== projectId) {
        throw new ForbiddenException('Invalid parentModuleId');
      }
    }

    const nextOrder = await this.nextModuleSortOrder(projectId, dto.parentModuleId ?? null);

    return this.prisma.$transaction(async (tx) => {
      const module = await tx.module.create({
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

      const labels = await tx.projectLabel.findMany({
        where: { projectId, defaultNotApplicable: true, deletedAt: null },
        select: { id: true },
      });
      if (labels.length > 0) {
        await tx.documentationField.createMany({
          data: labels.map((label) => ({
            projectId,
            entityType: DocumentationEntityType.MODULE,
            moduleId: module.id,
            labelId: label.id,
            isNotApplicable: true,
          })),
          skipDuplicates: true,
        });
      }

      return module;
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
      deletedAt: null,
      ...(parentModuleId !== undefined ? { parentModuleId } : {}),
    };
    const textFilter = text ? { OR: [{ name: text }, { description: text }] } : undefined;
    const where = textFilter ? { AND: [base, textFilter] } : base;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.module.findMany({
        where,
        skip,
        take,
        orderBy,
        include: { deletedBy: { select: { id: true, name: true, email: true } } },
      }),
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
    const mod = await this.requireModule(user, moduleId, 'WRITE');

    let parentUpdate: string | null | undefined;

    const parentProvided = Object.hasOwn(dto, 'parentModuleId');
    if (parentProvided) {
      const targetParentId = dto.parentModuleId ?? null;

      if (targetParentId === moduleId) {
        throw new BadRequestException('Module cannot be its own parent');
      }

      if (targetParentId) {
        const targetParent = await this.requireModule(user, targetParentId, 'WRITE');
        if (targetParent.projectId !== mod.projectId) {
          throw new ForbiddenException('Invalid parentModuleId');
        }

        const visited = new Set<string>();
        let cursor = targetParent.parentModuleId;
        while (cursor) {
          if (cursor === moduleId) {
            throw new ConflictException('Cannot move module inside its own subtree');
          }
          if (visited.has(cursor)) break;
          visited.add(cursor);
          const ancestor = await this.prisma.module.findUnique({
            where: { id: cursor },
            select: { parentModuleId: true },
          });
          cursor = ancestor?.parentModuleId ?? null;
        }
      }

      if (targetParentId !== mod.parentModuleId) {
        parentUpdate = targetParentId;
      }
    }

    const baseData = {
      name: dto.name ?? undefined,
      description: dto.description ?? undefined,
      isRoot: dto.isRoot ?? undefined,
      lastModifiedById: user.sub,
    };

    if (parentUpdate === undefined) {
      return this.prisma.module.update({
        where: { id: moduleId },
        data: baseData,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await this.compactOrdersAfterModuleMove(
        tx,
        mod.projectId,
        mod.parentModuleId ?? null,
        mod.sortOrder ?? null,
      );
      const nextOrder = await this.nextModuleSortOrder(
        mod.projectId,
        parentUpdate ?? null,
        tx,
      );
      return tx.module.update({
        where: { id: moduleId },
        data: {
          ...baseData,
          parentModuleId: parentUpdate ?? null,
          sortOrder: nextOrder,
        },
      });
    });
  }

  async moveOrder(user: AccessTokenPayload, moduleId: string, direction: MoveDirection) {
    const mod = await this.requireModule(user, moduleId, 'WRITE');
    const currentOrder = mod.sortOrder ?? 0;
    const neighbor = await this.findNeighborForModule(
      moduleId,
      mod.projectId,
      mod.parentModuleId ?? null,
      currentOrder,
      direction,
    );

    if (!neighbor) {
      throw new BadRequestException('No hay elementos para intercambiar en esa dirección');
    }

    const neighborOrder =
      neighbor.sortOrder ??
      (direction === MoveDirection.UP ? currentOrder - 1 : currentOrder + 1);

    await this.prisma.$transaction(async (tx) => {
      await tx.module.update({
        where: { id: moduleId },
        data: { sortOrder: neighborOrder, lastModifiedById: user.sub },
      });

      if (neighbor.type === 'module') {
        await tx.module.update({
          where: { id: neighbor.id },
          data: { sortOrder: currentOrder, lastModifiedById: user.sub },
        });
      } else {
        await tx.feature.update({
          where: { id: neighbor.id },
          data: { sortOrder: currentOrder, lastModifiedById: user.sub },
        });
      }
    });

    return { ok: true, moduleId, sortOrder: neighborOrder };
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
    const mod = await this.prisma.module.findFirst({
      where: { id: moduleId, deletedAt: null },
      include: {
        children: { where: { deletedAt: null }, select: { id: true, publishedVersionId: true } },
        features: { where: { deletedAt: null }, select: { id: true, publishedVersionId: true } },
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

    const mod = await this.prisma.module.findFirst({
      where: { id: moduleId, deletedAt: null },
      include: {
        project: { select: { id: true, ownerId: true } },
      },
    });

    if (!mod) throw new NotFoundException('Module not found');

    await this.requireProjectRole(user.sub, mod.project.id, 'WRITE');

    if (!cascade) {
      const [childCount, featureCount] = await this.prisma.$transaction([
        this.prisma.module.count({
          where: { parentModuleId: moduleId, deletedAt: null },
        }),
        this.prisma.feature.count({
          where: { moduleId, deletedAt: null },
        }),
      ]);
      if (childCount > 0 || featureCount > 0) {
      throw new ConflictException(
        'Module has children/features. Use ?cascade=true to delete subtree.',
      );
      }
    }

    // Recolectar todo el subárbol (moduleId + descendientes)
    const allModuleIds = cascade
      ? await this.collectModuleSubtreeIds(moduleId)
      : [moduleId];

    // Si no force, valida que nada publicado exista en el subárbol
    if (!force) {
      const publishedModuleCount = await this.prisma.module.count({
        where: {
          id: { in: allModuleIds },
          deletedAt: null,
          NOT: { publishedVersionId: null },
        },
      });
      const publishedFeatureCount = await this.prisma.feature.count({
        where: {
          moduleId: { in: allModuleIds },
          deletedAt: null,
          NOT: { publishedVersionId: null },
        },
      });
      if (publishedModuleCount > 0 || publishedFeatureCount > 0) {
        throw new ConflictException(
          'There are published modules/features in the subtree. Use ?force=true.',
        );
      }
    }

    const deletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.feature.updateMany({
        where: { moduleId: { in: allModuleIds }, deletedAt: null },
        data: { deletedAt, deletedById: user.sub },
      });
      await tx.module.updateMany({
        where: { id: { in: allModuleIds }, deletedAt: null },
        data: { deletedAt, deletedById: user.sub },
      });
    });

    return { ok: true, deletedModuleIds: allModuleIds };
  }

  async listDeletedInProject(
    user: AccessTokenPayload,
    projectId: string,
    parentModuleId?: string | null,
    query?: PaginationDto,
  ) {
    await this.requireProjectRole(user.sub, projectId, 'READ');

    const { page, take, skip } = clampPageLimit(query?.page, query?.limit);
    const orderBy = buildSort(query?.sort) ?? [
      { deletedAt: 'desc' as const },
      { createdAt: 'asc' as const },
    ];
    const text = like(query?.q);

    const base = {
      projectId,
      deletedAt: { not: null },
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

  async restore(user: AccessTokenPayload, moduleId: string) {
    const mod = await this.prisma.module.findFirst({
      where: { id: moduleId },
      select: { id: true, projectId: true, parentModuleId: true, deletedAt: true },
    });
    if (!mod) throw new NotFoundException('Module not found');
    if (!mod.deletedAt) throw new ConflictException('Module is not deleted');

    await this.requireProjectRole(user.sub, mod.projectId, 'WRITE');

    if (mod.parentModuleId) {
      const parent = await this.prisma.module.findFirst({
        where: { id: mod.parentModuleId, deletedAt: null },
        select: { id: true },
      });
      if (!parent) {
        throw new ConflictException('Parent module is deleted. Restore the parent first.');
      }
    }

    const allModuleIds = await this.collectModuleSubtreeIds(moduleId, { includeDeleted: true });
    const cutoff = mod.deletedAt;

    await this.prisma.$transaction(async (tx) => {
      await tx.feature.updateMany({
        where: { moduleId: { in: allModuleIds }, deletedAt: { gte: cutoff } },
        data: { deletedAt: null, deletedById: null },
      });
      await tx.module.updateMany({
        where: { id: { in: allModuleIds }, deletedAt: { gte: cutoff } },
        data: { deletedAt: null, deletedById: null },
      });
    });

    return { ok: true, restoredModuleIds: allModuleIds };
  }

  /**
   * BFS para obtener todos los ids (incluye el root moduleId).
   */
  private async collectModuleSubtreeIds(
    rootId: string,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<string[]> {
    const result: string[] = [];
    let frontier: string[] = [rootId];

    while (frontier.length > 0) {
      result.push(...frontier);

      // fetch children de esta capa
      const children = await this.prisma.module.findMany({
        where: opts.includeDeleted
          ? { parentModuleId: { in: frontier } }
          : { parentModuleId: { in: frontier }, deletedAt: null },
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
