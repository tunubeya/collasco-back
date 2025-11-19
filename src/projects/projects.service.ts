import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload } from '../auth/types/jwt-payload';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { buildSort, clampPageLimit, like } from 'src/common/utils/pagination';
import { parseRepoUrl } from 'src/github/utils/parse-repo-url';
import type { ListIssuesDto, ListPullsDto } from 'src/github/dto/list.dto';
import { GithubService } from 'src/github/github.service';
import { ProjectMemberRole, Visibility } from '@prisma/client';

type ModuleRow = {
  id: string;
  projectId: string;
  parentModuleId: string | null;
  name: string;
  isRoot: boolean;
  sortOrder: number;
  createdAt: Date;
  publishedVersionId: string | null;
};

type FeatureRow = {
  id: string;
  moduleId: string;
  name: string;
  status: import('@prisma/client').FeatureStatus;
  priority: import('@prisma/client').FeaturePriority | null;
  sortOrder: number;
  createdAt: Date;
  publishedVersionId: string | null;
};

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
  items: TreeNode[];
};

type TreeNode = TreeModuleNode | TreeFeatureNode;
export type ProjectStructureFeatureNode = TreeFeatureNode;
export type ProjectStructureModuleNode = TreeModuleNode;
export type ProjectStructureNode = TreeNode;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gh: GithubService,
  ) {}

  private compareModules(a: ModuleRow, b: ModuleRow) {
    const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    const aTime = a.createdAt.getTime();
    const bTime = b.createdAt.getTime();
    if (aTime !== bTime) return aTime - bTime;
    return a.name.localeCompare(b.name);
  }

  private buildModuleTree(modules: ModuleRow[], features: FeatureRow[]): TreeModuleNode[] {
    const modulesByParent = new Map<string | null, ModuleRow[]>();
    const featuresByModule = new Map<string, FeatureRow[]>();

    for (const mod of modules) {
      const parentKey = mod.parentModuleId ?? null;
      const list = modulesByParent.get(parentKey) ?? [];
      list.push(mod);
      modulesByParent.set(parentKey, list);
    }

    for (const feat of features) {
      const list = featuresByModule.get(feat.moduleId) ?? [];
      list.push(feat);
      featuresByModule.set(feat.moduleId, list);
    }

    const buildModuleNode = (mod: ModuleRow): TreeModuleNode => {
      const childModules = modulesByParent.get(mod.id) ?? [];
      const moduleFeatures = featuresByModule.get(mod.id) ?? [];

      const combined: Array<{ type: 'module'; value: ModuleRow } | { type: 'feature'; value: FeatureRow }> = [
        ...childModules.map((child) => ({ type: 'module' as const, value: child })),
        ...moduleFeatures.map((feat) => ({ type: 'feature' as const, value: feat })),
      ];

      combined.sort((a, b) => {
        const orderA = (a.type === 'module' ? a.value.sortOrder : a.value.sortOrder) ?? Number.MAX_SAFE_INTEGER;
        const orderB = (b.type === 'module' ? b.value.sortOrder : b.value.sortOrder) ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;

        const timeA = a.value.createdAt.getTime();
        const timeB = b.value.createdAt.getTime();
        if (timeA !== timeB) return timeA - timeB;

        if (a.type === b.type) {
          return a.value.name.localeCompare(b.value.name);
        }
        return a.type === 'module' ? -1 : 1;
      });

      const items: TreeNode[] = combined.map((entry, index) => {
        if (entry.type === 'module') {
          const childNode = buildModuleNode(entry.value);
          childNode.order = index + 1;
          return childNode;
        }

        const feat = entry.value;
        return {
          type: 'feature',
          id: feat.id,
          moduleId: feat.moduleId,
          name: feat.name,
          status: feat.status,
          priority: feat.priority,
          sortOrder: feat.sortOrder ?? null,
          order: index + 1,
          createdAt: feat.createdAt,
          publishedVersionId: feat.publishedVersionId,
        };
      });

      return {
        type: 'module',
        id: mod.id,
        name: mod.name,
        parentModuleId: mod.parentModuleId,
        isRoot: mod.isRoot,
        sortOrder: mod.sortOrder ?? null,
        order: 0,
        createdAt: mod.createdAt,
        publishedVersionId: mod.publishedVersionId,
        items,
      };
    };

    const roots = (modulesByParent.get(null) ?? []).slice().sort((a, b) => this.compareModules(a, b));
    return roots.map((root, index) => {
      const node = buildModuleNode(root);
      node.order = index + 1;
      return node;
    });
  }

  private buildTreesByProject(modules: ModuleRow[], features: FeatureRow[]) {
    const modulesByProject = new Map<string, ModuleRow[]>();
    const moduleProjectMap = new Map<string, string>();

    for (const mod of modules) {
      moduleProjectMap.set(mod.id, mod.projectId);
      const list = modulesByProject.get(mod.projectId) ?? [];
      list.push(mod);
      modulesByProject.set(mod.projectId, list);
    }

    const featuresByProject = new Map<string, FeatureRow[]>();
    for (const feat of features) {
      const projectId = moduleProjectMap.get(feat.moduleId);
      if (!projectId) continue;
      const list = featuresByProject.get(projectId) ?? [];
      list.push(feat);
      featuresByProject.set(projectId, list);
    }

    const result = new Map<string, TreeModuleNode[]>();
    for (const [projectId, projectModules] of modulesByProject.entries()) {
      const projectFeatures = featuresByProject.get(projectId) ?? [];
      result.set(projectId, this.buildModuleTree(projectModules, projectFeatures));
    }

    return result;
  }

  /** === Helpers de autorización === */
  private async getProjectOrThrow(id: string) {
    const p = await this.prisma.project.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private async ensureCanRead(user: AccessTokenPayload, projectId: string) {
    const p = await this.getProjectOrThrow(projectId);
    if (p.visibility === Visibility.PUBLIC) return p; // público
    if (p.ownerId === user.sub) return p;

    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: user.sub } },
    });
    if (!member) throw new ForbiddenException('Forbidden');
    return p;
  }

  private async ensureOwner(userId: string, projectId: string) {
    const p = await this.getProjectOrThrow(projectId);
    if (p.ownerId !== userId) throw new ForbiddenException('Owner only');
    return p;
  }

  private async ensureOwnerOrMaintainer(userId: string, projectId: string) {
    const project = await this.getProjectOrThrow(projectId);
    if (project.ownerId === userId) {
      return { project, role: ProjectMemberRole.OWNER };
    }

    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });

    if (!membership || membership.role !== ProjectMemberRole.MAINTAINER) {
      throw new ForbiddenException('Owner or maintainer only');
    }

    return { project, role: membership.role };
  }

  /** === GitHub repo utils === */
  private parseProjectRepoOrThrow(projectRepositoryUrl?: string) {
    const parsed = parseRepoUrl(projectRepositoryUrl ?? '');
    if (!parsed)
      throw new BadRequestException(
        'Project has no valid GitHub repositoryUrl (expected github.com/<owner>/<repo>)',
      );
    return parsed; // { owner, repo }
  }

  /** === CRUD proyecto === */
  async create(user: AccessTokenPayload, dto: CreateProjectDto) {
    if (dto.repositoryUrl) {
      const parsed = parseRepoUrl(dto.repositoryUrl);
      if (!parsed) {
        throw new BadRequestException('repositoryUrl debe ser https://github.com/<owner>/<repo>');
      }
    }
    return this.prisma.project.create({
      data: {
        name: dto.name,
        slug: null, // si luego agregas slug en DTO, setéalo aquí y valida @@unique([ownerId, slug])
        description: dto.description ?? null,
        status: dto.status ?? undefined,
        visibility: dto.visibility ?? undefined,
        deadline: null,
        repositoryUrl: dto.repositoryUrl ?? null,
        ownerId: user.sub,
        members: {
          create: { userId: user.sub, role: ProjectMemberRole.OWNER },
        },
      },
    });
  }

  async findMine(user: AccessTokenPayload, query: PaginationDto) {
    const { page, take, skip } = clampPageLimit(query.page, query.limit);
    const orderBy = buildSort(query.sort) ?? { updatedAt: 'desc' as const };
    const text = like(query.q);
    const accessFilter = {
      OR: [{ ownerId: user.sub }, { members: { some: { userId: user.sub } } }],
    };
    const textFilter = text ? { OR: [{ name: text }, { description: text }] } : undefined;

    const where = textFilter ? { AND: [accessFilter, textFilter] } : accessFilter;

    const [projects, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        skip,
        take,
        orderBy,
      }),
      this.prisma.project.count({ where }),
    ]);

    if (projects.length === 0) {
      return { items: [], total, page, limit: take };
    }

    const projectIds = projects.map((p) => p.id);

    const [modules, features] = await this.prisma.$transaction([
      this.prisma.module.findMany({
        where: { projectId: { in: projectIds } },
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
        where: { module: { projectId: { in: projectIds } } },
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

    const trees = this.buildTreesByProject(modules, features);
    const items = projects.map((project) => ({
      ...project,
      modules: trees.get(project.id) ?? [],
    }));

    return { items, total, page, limit: take };
  }

  async findOne(user: AccessTokenPayload, id: string) {
    await this.ensureCanRead(user, id);
    return this.prisma.project.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, email: true, name: true } },
        members: {
          include: { user: { select: { id: true, email: true, name: true } } },
        },
        githubCredential: true,
      },
    });
  }

  async getStructure(user: AccessTokenPayload, projectId: string) {
    await this.ensureCanRead(user, projectId);

    const [modules, features] = await this.prisma.$transaction([
      this.prisma.module.findMany({
        where: { projectId },
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
        where: { module: { projectId } },
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

    const modulesTree = this.buildModuleTree(modules, features);

    return { projectId, modules: modulesTree };
  }

  async update(user: AccessTokenPayload, id: string, dto: UpdateProjectDto) {
    const { project } = await this.ensureOwnerOrMaintainer(user.sub, id);

    if (dto.repositoryUrl !== undefined && dto.repositoryUrl !== null) {
      const parsed = parseRepoUrl(dto.repositoryUrl);
      if (!parsed) {
        throw new BadRequestException('repositoryUrl debe ser https://github.com/<owner>/<repo>');
      }

      // 💪 Validar que el token (project/user) realmente ve el repo
      const token = await this.gh.resolveTokenForProject(user.sub, id);
      if (!token)
        throw new ForbiddenException('Conecta GitHub (usuario o proyecto) para vincular un repo');

      const repoInfo = await this.gh.getRepo(parsed.owner, parsed.repo, { tokenOverride: token });
      if (!repoInfo?.permissions?.pull) {
        throw new ForbiddenException('Tu credencial no tiene acceso de lectura al repositorio');
      }
    }

    return this.prisma.project.update({
      where: { id },
      data: {
        name: dto.name ?? project.name,
        description: dto.description ?? project.description,
        status: dto.status ?? project.status,
        visibility: dto.visibility ?? project.visibility,
        repositoryUrl: dto.repositoryUrl ?? project.repositoryUrl ?? null,
      },
    });
  }

  async remove(user: AccessTokenPayload, id: string) {
    await this.ensureOwnerOrMaintainer(user.sub, id);
    await this.prisma.project.delete({ where: { id } });
    return { ok: true };
  }

  /** === Members (owner-only) === */
  async addMember(
    user: AccessTokenPayload,
    projectId: string,
    memberUserId: string,
    role: ProjectMemberRole = ProjectMemberRole.DEVELOPER,
  ) {
    const p = await this.ensureOwner(user.sub, projectId);
    if (memberUserId === p.ownerId) {
      throw new ConflictException('Owner ya es miembro implícito');
    }

    return this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: memberUserId } },
      create: { projectId, userId: memberUserId, role },
      update: { role },
    });
  }

  async updateMemberRole(
    user: AccessTokenPayload,
    projectId: string,
    memberUserId: string,
    role: ProjectMemberRole,
  ) {
    const p = await this.ensureOwner(user.sub, projectId);
    if (memberUserId === p.ownerId) {
      throw new ConflictException('No puedes cambiar el rol del owner');
    }

    return this.prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId: memberUserId } },
      data: { role },
    });
  }

  async removeMember(user: AccessTokenPayload, projectId: string, memberUserId: string) {
    const p = await this.ensureOwner(user.sub, projectId);
    if (memberUserId === p.ownerId) {
      throw new ConflictException('No puedes remover al owner');
    }

    await this.prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: memberUserId } },
    });
    return { ok: true };
  }

  /** === GitHub data === */
  async listProjectIssues(user: AccessTokenPayload, projectId: string, q: ListIssuesDto) {
    const project = await this.ensureCanRead(user, projectId);
    const { owner, repo } = this.parseProjectRepoOrThrow(project.repositoryUrl ?? undefined);

    const tokenOverride = await this.gh.resolveTokenForProject(user.sub, projectId);
    if (!tokenOverride) throw new ForbiddenException('Conecta GitHub para ver datos del repo');

    return this.gh.listRepoIssues(owner, repo, q, { tokenOverride });
  }

  async listProjectPulls(user: AccessTokenPayload, projectId: string, q: ListPullsDto) {
    const project = await this.ensureCanRead(user, projectId);
    const { owner, repo } = this.parseProjectRepoOrThrow(project.repositoryUrl ?? undefined);

    const tokenOverride = await this.gh.resolveTokenForProject(user.sub, projectId);
    if (!tokenOverride) throw new ForbiddenException('Conecta GitHub para ver datos del repo');

    return this.gh.listRepoPulls(owner, repo, q, { tokenOverride });
  }

  /** === ProjectGithubCredential (owner-only) === */
  async upsertProjectGithubCredential(
    user: AccessTokenPayload,
    projectId: string,
    dto: {
      accessToken: string;
      refreshToken?: string;
      tokenType?: string;
      scopes?: string;
      expiresAt?: Date;
    },
  ) {
    await this.ensureOwner(user.sub, projectId);

    return this.prisma.projectGithubCredential.upsert({
      where: { projectId },
      create: {
        projectId,
        accessToken: dto.accessToken,
        refreshToken: dto.refreshToken ?? null,
        tokenType: dto.tokenType ?? null,
        scopes: dto.scopes ?? null,
        expiresAt: dto.expiresAt ?? null,
      },
      update: {
        accessToken: dto.accessToken,
        refreshToken: dto.refreshToken ?? null,
        tokenType: dto.tokenType ?? null,
        scopes: dto.scopes ?? null,
        expiresAt: dto.expiresAt ?? null,
      },
    });
  }

  async deleteProjectGithubCredential(user: AccessTokenPayload, projectId: string) {
    await this.ensureOwner(user.sub, projectId);
    try {
      await this.prisma.projectGithubCredential.delete({ where: { projectId } });
    } catch {
      // idempotente
    }
    return { ok: true };
  }
}
