import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';
import type { CreateFeatureDto } from './dto/create-feature.dto';
import type { UpdateFeatureDto } from './dto/update-feature.dto';
import type { LinkIssueElementDto } from './dto/link-IssueElement.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { buildSort, clampPageLimit, like } from 'src/common/utils/pagination';
import { CommitSummary, GithubService } from 'src/github/github.service';
import { SyncCommitsDto } from './dto/sync-commits.dto';
import { FeatureStatus, Prisma, ProjectMemberRole, ReviewStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { MoveDirection } from 'src/common/dto/move-order.dto';

type Allowed = 'READ' | 'WRITE';
const READ_ROLES: ProjectMemberRole[] = ['OWNER', 'MAINTAINER', 'DEVELOPER', 'VIEWER'];
const WRITE_ROLES: ProjectMemberRole[] = ['OWNER', 'MAINTAINER'];

type NeighborCandidate = {
  type: 'module' | 'feature';
  id: string;
  sortOrder: number | null;
};

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

@Injectable()
export class FeaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gh: GithubService,
  ) {}

  // ===== Helpers permisos (mismo patrón que ModulesService) =====
  private async requireProjectRole(userId: string, projectId: string, allowed: Allowed) {
    const p = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    if (!p) throw new NotFoundException('Project not found');
    if (p.ownerId === userId) return { role: 'OWNER' as const };

    const m = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    if (!m) throw new ForbiddenException('Not a project member');

    const roles = allowed === 'READ' ? READ_ROLES : WRITE_ROLES;
    if (!roles.includes(m.role)) throw new ForbiddenException('Insufficient role');
    return m;
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

  private async requireFeature(user: AccessTokenPayload, featureId: string, allowed: Allowed) {
    const feature = await this.prisma.feature.findUnique({
      where: { id: featureId },
      select: {
        id: true,
        moduleId: true,
        sortOrder: true,
        module: { select: { projectId: true } },
      },
    });
    if (!feature) throw new NotFoundException('Feature not found');
    // valida permisos por proyecto a partir del módulo
    await this.requireModule(user, feature.moduleId, allowed);
    return feature;
  }

  private async nextSortOrderInModule(
    moduleId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const [moduleMax, featureMax] = await Promise.all([
      client.module.aggregate({
        _max: { sortOrder: true },
        where: { parentModuleId: moduleId },
      }),
      client.feature.aggregate({
        _max: { sortOrder: true },
        where: { moduleId },
      }),
    ]);

    return Math.max(moduleMax._max.sortOrder ?? -1, featureMax._max.sortOrder ?? -1) + 1;
  }

  private async compactOrdersAfterFeatureMove(
    tx: Prisma.TransactionClient,
    moduleId: string,
    removedOrder: number | null,
  ) {
    if (removedOrder === null) return;
    await Promise.all([
      tx.module.updateMany({
        where: { parentModuleId: moduleId, sortOrder: { gt: removedOrder } },
        data: { sortOrder: { decrement: 1 } },
      }),
      tx.feature.updateMany({
        where: { moduleId, sortOrder: { gt: removedOrder } },
        data: { sortOrder: { decrement: 1 } },
      }),
    ]);
  }

  private pickNeighbor(
    direction: MoveDirection,
    candidates: NeighborCandidate[],
  ): NeighborCandidate | null {
    if (!candidates.length) return null;
    return candidates.reduce<NeighborCandidate | null>((best, candidate) => {
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

  private async findNeighborInModule(
    moduleId: string,
    currentOrder: number,
    direction: MoveDirection,
  ): Promise<NeighborCandidate | null> {
    const orderFilter =
      direction === MoveDirection.UP ? { lt: currentOrder } : { gt: currentOrder };
    const orderBy = { sortOrder: direction === MoveDirection.UP ? 'desc' : 'asc' } as const;

    const [moduleNeighbor, featureNeighbor] = await Promise.all([
      this.prisma.module.findFirst({
        where: { parentModuleId: moduleId, sortOrder: orderFilter },
        orderBy,
        select: { id: true, sortOrder: true },
      }),
      this.prisma.feature.findFirst({
        where: { moduleId, sortOrder: orderFilter },
        orderBy,
        select: { id: true, sortOrder: true },
      }),
    ]);

    const candidates: NeighborCandidate[] = [];
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

  // ===== CRUD en módulo =====
  async createInModule(user: AccessTokenPayload, moduleId: string, dto: CreateFeatureDto) {
    await this.requireModule(user, moduleId, 'WRITE');

    const nextOrder = await this.nextSortOrderInModule(moduleId);

    return this.prisma.feature.create({
      data: {
        moduleId,
        name: dto.name,
        description: dto.description ?? null,
        priority: dto.priority === null ? null : dto.priority ?? undefined,
        status: dto.status === null ? null : dto.status ?? FeatureStatus.PENDING,
        lastModifiedById: user.sub,
        sortOrder: nextOrder,
      },
    });
  }

  async listInModule(user: AccessTokenPayload, moduleId: string, query: PaginationDto) {
    await this.requireModule(user, moduleId, 'READ');
    const { page, take, skip } = clampPageLimit(query.page, query.limit);
    const orderBy =
      buildSort(query.sort) ??
      [
        { sortOrder: 'asc' as const },
        { createdAt: 'asc' as const },
        { name: 'asc' as const },
      ];
    const text = like(query.q);

    const base = { moduleId };
    const textFilter = text ? { OR: [{ name: text }, { description: text }] } : undefined;
    const where = textFilter ? { AND: [base, textFilter] } : base;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.feature.findMany({ where, skip, take, orderBy }),
      this.prisma.feature.count({ where }),
    ]);
    return { items, total, page, limit: take };
  }

  async getOne(user: AccessTokenPayload, featureId: string) {
    await this.requireFeature(user, featureId, 'READ');
    return this.prisma.feature.findUnique({
      where: { id: featureId },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: {
            id: true,
            versionNumber: true,
            changelog: true,
            createdAt: true,
            isRollback: true,
            createdById: true,
          },
        },
        issueElements: true,
        publishedVersion: { select: { id: true, versionNumber: true } },
      },
    });
  }

  async update(user: AccessTokenPayload, featureId: string, dto: UpdateFeatureDto) {
    const feature = await this.requireFeature(user, featureId, 'WRITE');

    let moduleUpdate: string | undefined;

    if (dto.moduleId && dto.moduleId !== feature.moduleId) {
      const targetModule = await this.requireModule(user, dto.moduleId, 'WRITE');
      const currentProjectId = feature.module.projectId;
      if (targetModule.projectId !== currentProjectId) {
        throw new BadRequestException('Feature cannot be moved to another project');
      }
      moduleUpdate = dto.moduleId;
    }

    const baseData = {
      name: dto.name ?? undefined,
      description: dto.description ?? undefined,
      priority: dto.priority === null ? null : dto.priority ?? undefined,
      status: dto.status === null ? null : dto.status ?? undefined,
      lastModifiedById: user.sub,
    };

    if (!moduleUpdate) {
      return this.prisma.feature.update({
        where: { id: featureId },
        data: baseData,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await this.compactOrdersAfterFeatureMove(tx, feature.moduleId, feature.sortOrder ?? null);
      const nextOrder = await this.nextSortOrderInModule(moduleUpdate, tx);
      return tx.feature.update({
        where: { id: featureId },
        data: {
          ...baseData,
          moduleId: moduleUpdate,
          sortOrder: nextOrder,
        },
      });
    });
  }

  async moveOrder(user: AccessTokenPayload, featureId: string, direction: MoveDirection) {
    const feature = await this.requireFeature(user, featureId, 'WRITE');
    const currentOrder = feature.sortOrder ?? 0;
    const neighbor = await this.findNeighborInModule(feature.moduleId, currentOrder, direction);
    if (!neighbor) {
      throw new BadRequestException('No hay elementos para intercambiar en esa dirección');
    }

    const neighborOrder =
      neighbor.sortOrder ??
      (direction === MoveDirection.UP ? currentOrder - 1 : currentOrder + 1);

    await this.prisma.$transaction(async (tx) => {
      await tx.feature.update({
        where: { id: featureId },
        data: { sortOrder: neighborOrder, lastModifiedById: user.sub },
      });

      if (neighbor.type === 'feature') {
        await tx.feature.update({
          where: { id: neighbor.id },
          data: { sortOrder: currentOrder, lastModifiedById: user.sub },
        });
      } else {
        await tx.module.update({
          where: { id: neighbor.id },
          data: { sortOrder: currentOrder, lastModifiedById: user.sub },
        });
      }
    });

    return { ok: true, featureId, sortOrder: neighborOrder };
  }

  // ===== Versionado (dedupe por contentHash) =====
  private async snapshotInternal(
    featureId: string,
    userId: string,
    changelog?: string,
    asRollback?: boolean,
  ) {
    const f = await this.prisma.feature.findUnique({
      where: { id: featureId },
      select: { name: true, description: true, priority: true, status: true },
    });
    if (!f) throw new NotFoundException('Feature not found');

    const payloadForHash = {
      name: f.name,
      description: f.description ?? null,
      priority: f.priority ?? null,
      status: f.status ?? null,
    };
    const hash = contentHashOf(payloadForHash);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.featureVersion.findUnique({
        where: { featureId_contentHash: { featureId, contentHash: hash } },
        select: { id: true, versionNumber: true },
      });
      if (existing) return existing;

      const last = await tx.featureVersion.findFirst({
        where: { featureId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const next = (last?.versionNumber ?? 0) + 1;

      return tx.featureVersion.create({
        data: {
          featureId,
          versionNumber: next,
          name: f.name,
          description: f.description ?? null,
          priority: f.priority ?? null,
          status: f.status ?? null,
          changelog: changelog ?? null,
          createdById: userId,
          isRollback: !!asRollback,
          contentHash: hash,
        },
        select: { id: true, versionNumber: true },
      });
    });
  }

  async snapshot(user: AccessTokenPayload, featureId: string, changelog?: string) {
    await this.requireFeature(user, featureId, 'WRITE');
    return this.snapshotInternal(featureId, user.sub, changelog, false);
  }

  async rollback(
    user: AccessTokenPayload,
    featureId: string,
    versionNumber: number,
    changelog?: string,
  ) {
    await this.requireFeature(user, featureId, 'WRITE');

    const ver = await this.prisma.featureVersion.findUnique({
      where: { featureId_versionNumber: { featureId, versionNumber } },
      select: { name: true, description: true, priority: true, status: true },
    });
    if (!ver) throw new NotFoundException('Feature version not found');

    // 1) aplicar estado de la versión
    await this.prisma.feature.update({
      where: { id: featureId },
      data: {
        name: ver.name ?? undefined,
        description: ver.description ?? null,
        priority: ver.priority ?? null,
        status: ver.status!,
        lastModifiedById: user.sub,
      },
    });

    // 2) snapshot (marcado rollback, dedupe si ya existía)
    return this.snapshotInternal(
      featureId,
      user.sub,
      changelog ?? `Rollback to v${versionNumber}`,
      true,
    );
  }

  async publish(user: AccessTokenPayload, featureId: string, versionNumber: number) {
    await this.requireFeature(user, featureId, 'WRITE');
    const ver = await this.prisma.featureVersion.findUnique({
      where: { featureId_versionNumber: { featureId, versionNumber } },
      select: { id: true },
    });
    if (!ver) throw new NotFoundException('Feature version not found');

    await this.prisma.feature.update({
      where: { id: featureId },
      data: { publishedVersionId: ver.id, lastModifiedById: user.sub },
    });
    return { ok: true };
  }

  async listVersions(user: AccessTokenPayload, featureId: string) {
    await this.requireFeature(user, featureId, 'READ');
    return this.prisma.featureVersion.findMany({
      where: { featureId },
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

  // ===== ISSUE: link / update / unlink / sync =====
  async linkIssue(user: AccessTokenPayload, featureId: string, dto: LinkIssueElementDto) {
    await this.requireFeature(user, featureId, 'WRITE');

    // Parsear URLs si vienen, para poblar owner/repo/numbers
    let repoOwner: string | undefined;
    let repoName: string | undefined;
    let issueNum: number | undefined;
    let prNum: number | undefined;

    if (dto.githubIssueUrl) {
      const p = this.gh.parseUrl(dto.githubIssueUrl); // may throw BadRequestException
      repoOwner = p.owner;
      repoName = p.repo;
      issueNum = p.number;
    }
    if (dto.pullRequestUrl) {
      const p = this.gh.parseUrl(dto.pullRequestUrl);
      // si ya teníamos owner/repo del issue, valida consistencia
      if ((repoOwner && repoOwner !== p.owner) || (repoName && repoName !== p.repo)) {
        throw new BadRequestException('Issue y Pull Request pertenecen a repos distintos');
      }
      repoOwner = p.owner;
      repoName = p.repo;
      prNum = p.number;
    }

    return this.prisma.issueElement.create({
      data: {
        featureId,
        githubIssueUrl: dto.githubIssueUrl ?? null,
        pullRequestUrl: dto.pullRequestUrl ?? null,
        repoOwner: repoOwner ?? null,
        repoName: repoName ?? null,
        githubIssueNumber: issueNum ?? null,
        githubPrNumber: prNum ?? null,
        commitHashes: dto.commitHashes ?? [],
        reviewStatus: dto.reviewStatus ?? null,
      },
    });
  }

  async updateIssue(user: AccessTokenPayload, issueId: string, dto: LinkIssueElementDto) {
    const issue = await this.prisma.issueElement.findUnique({ where: { id: issueId } });
    if (!issue) throw new NotFoundException('Issue not found');
    await this.requireFeature(user, issue.featureId, 'WRITE');

    let repoOwner = issue.repoOwner ?? undefined;
    let repoName = issue.repoName ?? undefined;
    let issueNum = issue.githubIssueNumber ?? undefined;
    let prNum = issue.githubPrNumber ?? undefined;

    if (dto.githubIssueUrl) {
      const p = this.gh.parseUrl(dto.githubIssueUrl);
      repoOwner = p.owner;
      repoName = p.repo;
      issueNum = p.number;
    }
    if (dto.pullRequestUrl) {
      const p = this.gh.parseUrl(dto.pullRequestUrl);
      if ((repoOwner && repoOwner !== p.owner) || (repoName && repoName !== p.repo)) {
        throw new BadRequestException('Issue y Pull Request pertenecen a repos distintos');
      }
      repoOwner = p.owner;
      repoName = p.repo;
      prNum = p.number;
    }

    return this.prisma.issueElement.update({
      where: { id: issueId },
      data: {
        githubIssueUrl: dto.githubIssueUrl ?? issue.githubIssueUrl,
        pullRequestUrl: dto.pullRequestUrl ?? issue.pullRequestUrl,
        repoOwner: repoOwner ?? null,
        repoName: repoName ?? null,
        githubIssueNumber: issueNum ?? null,
        githubPrNumber: prNum ?? null,
        commitHashes: dto.commitHashes ?? issue.commitHashes,
        reviewStatus: dto.reviewStatus ?? issue.reviewStatus,
      },
    });
  }

  async unlinkIssue(user: AccessTokenPayload, issueId: string) {
    const issue = await this.prisma.issueElement.findUnique({ where: { id: issueId } });
    if (!issue) throw new NotFoundException('Issue not found');
    await this.requireFeature(user, issue.featureId, 'WRITE');
    await this.prisma.issueElement.delete({ where: { id: issueId } });
    return { ok: true };
  }

  async syncIssueFromGithub(user: AccessTokenPayload, issueId: string) {
    const issue = await this.prisma.issueElement.findUnique({ where: { id: issueId } });
    if (!issue) throw new NotFoundException('issue not found');
    await this.requireFeature(user, issue.featureId, 'READ');

    // Valida recursos; si no hay URLs, simplemente no toca esos campos
    if (issue.githubIssueUrl) {
      await this.gh.getIssueByUrl(issue.githubIssueUrl); // lanza 404/401/403 si corresponde
    }
    const pr = issue.pullRequestUrl ? await this.gh.getPullByUrl(issue.pullRequestUrl) : undefined;

    let reviewStatus = issue.reviewStatus;
    if (pr?.merged) reviewStatus = ReviewStatus.APPROVED;
    else if (pr) reviewStatus = ReviewStatus.PENDING;

    let commitHashes = issue.commitHashes ?? [];
    if (issue.pullRequestUrl) {
      const commits: CommitSummary[] = await this.gh.listPullCommits(issue.pullRequestUrl);
      const shas = commits.map((c) => c.sha);
      const set = new Set([...commitHashes, ...shas]);
      commitHashes = Array.from(set);
    }

    return this.prisma.issueElement.update({
      where: { id: issueId },
      data: { reviewStatus, commitHashes },
    });
  }

  async syncIssueCommits(user: AccessTokenPayload, issueId: string, opts?: SyncCommitsDto) {
    const issue = await this.prisma.issueElement.findUnique({ where: { id: issueId } });
    if (!issue) throw new NotFoundException('QMS not found');
    await this.requireFeature(user, issue.featureId, 'READ');

    if (!issue.pullRequestUrl) {
      throw new NotFoundException('QMS has no pullRequestUrl to sync commits from');
    }

    const list = await this.gh.listPullCommits(issue.pullRequestUrl);
    const newShas = list.map((c) => c.sha);

    let finalShas: string[];
    if (opts?.append ?? true) {
      const set = new Set<string>(issue.commitHashes ?? []);
      for (const sha of newShas) set.add(sha);
      finalShas = Array.from(set);
    } else {
      finalShas = newShas;
    }

    if (opts?.limit && finalShas.length > opts.limit) {
      finalShas = finalShas.slice(-opts.limit);
    }

    return this.prisma.issueElement.update({
      where: { id: issueId },
      data: { commitHashes: finalShas },
    });
  }

  async delete(user: AccessTokenPayload, featureId: string, opts: { force?: boolean } = {}) {
    const { force = false } = opts;

    await this.requireFeature(user, featureId, 'WRITE');

    const feature = await this.prisma.feature.findUnique({
      where: { id: featureId },
      include: {
        module: { select: { project: { select: { id: true, ownerId: true } } } },
      },
    });

    if (!feature) throw new NotFoundException('Feature not found');

    if (feature.publishedVersionId && !force) {
      throw new ConflictException('Feature is published. Use ?force=true to delete.');
    }

    await this.prisma.$transaction(async (tx) => {
      // Borra dependencias en orden seguro
      await tx.issueElement.deleteMany({ where: { featureId } });
      await tx.featureVersion.deleteMany({ where: { featureId } });
      await tx.feature.delete({ where: { id: featureId } });
    });

    return { ok: true, deletedFeatureId: featureId };
  }
}
