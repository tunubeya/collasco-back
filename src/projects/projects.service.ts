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
import { DocumentationEntityType, Prisma, Visibility } from '@prisma/client';
import {
  DEFAULT_PROJECT_ROLES,
  DEFAULT_MEMBER_ROLE_NAME,
  PERMISSION_KEYS,
  type PermissionKey,
  ensurePermissionsExist,
  fetchPermissionIds,
  hasProjectPermission,
  requireProjectPermission,
} from './permissions';

export type VisibleDocumentationLabel = {
  id: string;
  name: string;
  isMandatory: boolean;
  order: number;
};

type DocumentationLabelSummary = {
  labelId: string;
  labelName: string;
  isMandatory: boolean;
  displayOrder: number;
  content: string | null;
  isNotApplicable: boolean;
  updatedAt: Date;
};

type LinkedFeatureSummary = {
  id: string;
  name: string;
  moduleId: string;
  moduleName: string;
  reason: string | null;
  direction: 'references' | 'referenced_by';
};

type ModuleRow = {
  id: string;
  projectId: string;
  parentModuleId: string | null;
  name: string;
  isRoot: boolean;
  sortOrder: number;
  createdAt: Date;
  publishedVersionId: string | null;
  documentationLabels: DocumentationLabelSummary[];
};

type FeatureRow = {
  id: string;
  moduleId: string;
  name: string;
  status: import('@prisma/client').FeatureStatus | null;
  priority: import('@prisma/client').FeaturePriority | null;
  sortOrder: number;
  createdAt: Date;
  publishedVersionId: string | null;
  documentationLabels: DocumentationLabelSummary[];
  linkedFeatures: LinkedFeatureSummary[];
};

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
  documentationLabels: DocumentationLabelSummary[];
  linkedFeatures: LinkedFeatureSummary[];
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
  documentationLabels: DocumentationLabelSummary[];
  items: TreeNode[];
};

type TreeNode = TreeModuleNode | TreeFeatureNode;
export type ProjectStructureFeatureNode = TreeFeatureNode;
export type ProjectStructureModuleNode = TreeModuleNode;
export type ProjectStructureNode = TreeNode;
export type DocumentationLabelPreferencePayload = {
  projectId: string;
  availableLabels: VisibleDocumentationLabel[];
  selectedLabelIds: string[];
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gh: GithubService,
  ) {}

  private async resolveProjectRole(userId: string, project: { id: string; ownerId: string }) {
    if (project.ownerId === userId) {
      return this.prisma.projectRole.findFirst({
        where: { projectId: project.id, isOwner: true },
        select: { id: true, name: true, isOwner: true },
      });
    }
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId } },
      select: { role: { select: { id: true, name: true, isOwner: true } } },
    });
    return membership?.role ?? null;
  }

  private canViewDocumentationLabel(
    roleId: string | null,
    visibleRoleIds?: string[] | null,
    isOwner = false,
  ): boolean {
    if (isOwner) {
      return true;
    }
    if (!visibleRoleIds || visibleRoleIds.length === 0) {
      return true;
    }
    if (!roleId) return false;
    return visibleRoleIds.includes(roleId);
  }

  private filterVisibleLabels(
    labels: Array<{
      id: string;
      name: string;
      isMandatory: boolean;
      visibleRoleIds: string[] | null;
      displayOrder: number;
    }>,
    role: { id: string; isOwner: boolean } | null,
  ): VisibleDocumentationLabel[] {
    return labels
      .filter((label) =>
        this.canViewDocumentationLabel(
          role?.id ?? null,
          label.visibleRoleIds ?? [],
          role?.isOwner ?? false,
        ),
      )
      .map((label) => ({
        id: label.id,
        name: label.name,
        isMandatory: label.isMandatory,
        order: label.displayOrder ?? 0,
      }));
  }

  private async loadVisibleLabelsForRole(projectId: string, role: { id: string; isOwner: boolean } | null) {
    const labels = await this.prisma.projectLabel.findMany({
      where: { projectId, deletedAt: null },
      select: {
        id: true,
        name: true,
        isMandatory: true,
        displayOrder: true,
        visibleRoles: { select: { roleId: true } },
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const mapped = labels.map((label) => ({
      ...label,
      visibleRoleIds: label.visibleRoles.map((entry) => entry.roleId),
    }));
    return this.filterVisibleLabels(mapped, role);
  }

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
          documentationLabels: feat.documentationLabels,
          linkedFeatures: feat.linkedFeatures,
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
        documentationLabels: mod.documentationLabels,
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

  private normalizeLabelIds(ids: string[]) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of ids) {
      const trimmed = value.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      result.push(trimmed);
    }
    return result;
  }

  private parseLabelsCsv(labelsCsv?: string) {
    if (!labelsCsv) return [];
    return this.normalizeLabelIds(labelsCsv.split(','));
  }

  private async buildManualForViewer(
    projectId: string,
    baseLabelIds: string[] | null,
    labelsCsv?: string,
    projectOverride?: { id: string; name: string; description: string | null; deletedAt?: Date | null },
    root?: { rootType?: DocumentationEntityType | null; rootId?: string | null },
  ) {
    const project =
      projectOverride ??
      (await this.prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: { id: true, name: true, description: true, deletedAt: true },
      }));
    if (!project || project.deletedAt) throw new NotFoundException('Project not found');

    const rawLabelIds = this.parseLabelsCsv(labelsCsv);
    const baseSet = baseLabelIds ? new Set(baseLabelIds) : null;
    const querySet = rawLabelIds.length > 0 ? new Set(rawLabelIds) : null;

    const [rawModules, rawFeatures, labels, documentationFields, featureLinkRows] =
      await this.prisma.$transaction([
        this.prisma.module.findMany({
          where: { projectId, deletedAt: null },
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
          where: { module: { projectId, deletedAt: null }, deletedAt: null },
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
        this.prisma.projectLabel.findMany({
          where: { projectId, deletedAt: null },
          select: {
            id: true,
            name: true,
            isMandatory: true,
            displayOrder: true,
            visibleRoles: { select: { roleId: true } },
          },
          orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        this.prisma.documentationField.findMany({
          where: {
            projectId,
            entityType: {
              in: [
                DocumentationEntityType.MODULE,
                DocumentationEntityType.FEATURE,
                DocumentationEntityType.PROJECT,
              ],
            },
          },
          select: {
            labelId: true,
            entityType: true,
            moduleId: true,
            featureId: true,
            content: true,
            isNotApplicable: true,
            updatedAt: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.featureLink.findMany({
          where: {
            feature: { module: { projectId, deletedAt: null }, deletedAt: null },
            linkedFeature: { deletedAt: null },
          },
          include: {
            feature: {
              select: {
                id: true,
                name: true,
                module: { select: { id: true, name: true } },
              },
            },
            linkedFeature: {
              select: {
                id: true,
                name: true,
                module: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

    const resolvedRootType = root?.rootType ?? DocumentationEntityType.PROJECT;
    const resolvedRootId = root?.rootId ?? null;
    let scopedModules = rawModules;
    let scopedFeatures = rawFeatures;
    let includeProjectDocs = true;

    if (resolvedRootType === DocumentationEntityType.MODULE) {
      if (!resolvedRootId) {
        throw new BadRequestException('Root module is required.');
      }
      const rootModule = rawModules.find((mod) => mod.id === resolvedRootId);
      if (!rootModule) {
        throw new NotFoundException('Root module not found.');
      }
      const modulesByParent = new Map<string | null, string[]>();
      for (const mod of rawModules) {
        const parentKey = mod.parentModuleId ?? null;
        const list = modulesByParent.get(parentKey) ?? [];
        list.push(mod.id);
        modulesByParent.set(parentKey, list);
      }
      const allowed = new Set<string>();
      const stack = [rootModule.id];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (allowed.has(current)) continue;
        allowed.add(current);
        const children = modulesByParent.get(current) ?? [];
        for (const child of children) stack.push(child);
      }

      scopedModules = rawModules.map((mod) =>
        mod.id === rootModule.id ? { ...mod, parentModuleId: null, isRoot: true } : mod,
      ).filter((mod) => allowed.has(mod.id));
      scopedFeatures = rawFeatures.filter((feat) => allowed.has(feat.moduleId));
      includeProjectDocs = false;
    } else if (resolvedRootType === DocumentationEntityType.FEATURE) {
      if (!resolvedRootId) {
        throw new BadRequestException('Root feature is required.');
      }
      const rootFeature = rawFeatures.find((feat) => feat.id === resolvedRootId);
      if (!rootFeature) {
        throw new NotFoundException('Root feature not found.');
      }
      const rootModule = rawModules.find((mod) => mod.id === rootFeature.moduleId);
      if (!rootModule) {
        throw new NotFoundException('Root module not found.');
      }
      scopedModules = [
        {
          ...rootModule,
          parentModuleId: null,
          isRoot: true,
        },
      ];
      scopedFeatures = [rootFeature];
      includeProjectDocs = false;
    }

    const visibleLabels = labels.map((label) => ({
      id: label.id,
      name: label.name,
      isMandatory: label.isMandatory,
      order: label.displayOrder ?? 0,
    }));

    let filteredVisibleLabels = visibleLabels;
    if (baseSet) {
      filteredVisibleLabels = filteredVisibleLabels.filter((label) => baseSet.has(label.id));
    }
    if (querySet) {
      filteredVisibleLabels = filteredVisibleLabels.filter((label) => querySet.has(label.id));
    }
    const visibleLabelMap = new Map(filteredVisibleLabels.map((label) => [label.id, label]));

    const moduleDocs = new Map<string, DocumentationLabelSummary[]>();
    const featureDocs = new Map<string, DocumentationLabelSummary[]>();
    const projectDocs: DocumentationLabelSummary[] = [];
    const featureLinksMap = new Map<string, LinkedFeatureSummary[]>();

    for (const record of documentationFields) {
      const labelInfo = visibleLabelMap.get(record.labelId);
      if (!labelInfo) continue;
      const summary: DocumentationLabelSummary = {
        labelId: record.labelId,
        labelName: labelInfo.name,
        isMandatory: labelInfo.isMandatory,
        displayOrder: labelInfo.order,
        content: record.content ?? null,
        isNotApplicable: record.isNotApplicable,
        updatedAt: record.updatedAt,
      };
      if (record.entityType === DocumentationEntityType.MODULE && record.moduleId) {
        const list = moduleDocs.get(record.moduleId) ?? [];
        list.push(summary);
        moduleDocs.set(record.moduleId, list);
      } else if (record.entityType === DocumentationEntityType.FEATURE && record.featureId) {
        const list = featureDocs.get(record.featureId) ?? [];
        list.push(summary);
        featureDocs.set(record.featureId, list);
      } else if (record.entityType === DocumentationEntityType.PROJECT && includeProjectDocs) {
        projectDocs.push(summary);
      }
    }

    const sortDocumentation = (docs: DocumentationLabelSummary[]) =>
      docs
        .slice()
        .sort((a, b) => {
          if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
          return a.labelName.localeCompare(b.labelName);
        });

    const addLink = (
      sourceId: string,
      target: { id: string; name: string; module: { id: string; name: string } },
      direction: 'references' | 'referenced_by',
      reason: string | null,
    ) => {
      const list = featureLinksMap.get(sourceId) ?? [];
      list.push({
        id: target.id,
        name: target.name,
        moduleId: target.module.id,
        moduleName: target.module.name,
        direction,
        reason,
      });
      featureLinksMap.set(sourceId, list);
    };
    for (const link of featureLinkRows) {
      const linkReason = link.reason ?? null;
      const firstDirection = link.initiatorFeatureId === link.feature.id ? 'references' : 'referenced_by';
      const secondDirection =
        link.initiatorFeatureId === link.linkedFeature.id ? 'references' : 'referenced_by';
      addLink(link.feature.id, link.linkedFeature, firstDirection, linkReason);
      addLink(link.linkedFeature.id, link.feature, secondDirection, linkReason);
    }

    const sortLinkedFeatures = (items: LinkedFeatureSummary[]) =>
      items
        .slice()
        .sort((a, b) => a.moduleName.localeCompare(b.moduleName) || a.name.localeCompare(b.name));

    const modules: ModuleRow[] = scopedModules.map((mod) => ({
      ...mod,
      documentationLabels: sortDocumentation(moduleDocs.get(mod.id) ?? []),
    }));
    const features: FeatureRow[] = scopedFeatures.map((feat) => ({
      ...feat,
      documentationLabels: sortDocumentation(featureDocs.get(feat.id) ?? []),
      linkedFeatures: sortLinkedFeatures(featureLinksMap.get(feat.id) ?? []),
    }));

    const modulesTree = this.buildModuleTree(modules, features);

    return {
      projectId,
      description: project.description,
      documentationLabels: sortDocumentation(projectDocs),
      modules: modulesTree,
      project: { id: project.id, name: project.name, description: project.description },
      rootType: resolvedRootType,
      rootId: resolvedRootType === DocumentationEntityType.PROJECT ? null : resolvedRootId,
    };
  }

  /** === Helpers de autorización === */
  private async getProjectOrThrow(id: string, opts: { includeDeleted?: boolean } = {}) {
    const p = await this.prisma.project.findFirst({
      where: opts.includeDeleted ? { id } : { id, deletedAt: null },
    });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private async ensureCanRead(user: AccessTokenPayload, projectId: string) {
    const p = await this.getProjectOrThrow(projectId);
    if (p.visibility === Visibility.PUBLIC) return p; // público
    const ok = await hasProjectPermission(this.prisma, user.sub, projectId, PERMISSION_KEYS.PROJECT_READ);
    if (!ok) throw new ForbiddenException('Forbidden');
    return p;
  }

  private async ensureProjectPermission(
    userId: string,
    projectId: string,
    permission: PermissionKey,
    opts: { includeDeleted?: boolean } = {},
  ) {
    const project = await this.getProjectOrThrow(projectId, opts);
    await requireProjectPermission(this.prisma, userId, projectId, permission);
    return project;
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

  private async touchProject(projectId: string): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });
  }

  private async getDefaultRoleId(projectId: string): Promise<string> {
    const role =
      (await this.prisma.projectRole.findFirst({
        where: { projectId, name: DEFAULT_MEMBER_ROLE_NAME },
        select: { id: true, isOwner: true },
      })) ??
      (await this.prisma.projectRole.findFirst({
        where: { projectId, isDefault: true, isOwner: false },
        select: { id: true, isOwner: true },
        orderBy: { createdAt: 'asc' },
      }));
    if (!role || role.isOwner) {
      throw new BadRequestException('No hay rol por defecto para el proyecto');
    }
    return role.id;
  }

  private normalizePermissionKeys(keys: string[]): PermissionKey[] {
    const allowed = new Set(Object.values(PERMISSION_KEYS));
    const unique = Array.from(new Set(keys));
    const invalid = unique.filter((key) => !allowed.has(key as PermissionKey));
    if (invalid.length > 0) {
      throw new BadRequestException(`Permisos inválidos: ${invalid.join(', ')}`);
    }
    return unique as PermissionKey[];
  }

  /** === CRUD proyecto === */
  async create(user: AccessTokenPayload, dto: CreateProjectDto) {
    if (dto.repositoryUrl) {
      const parsed = parseRepoUrl(dto.repositoryUrl);
      if (!parsed) {
        throw new BadRequestException('repositoryUrl debe ser https://github.com/<owner>/<repo>');
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name: dto.name,
          slug: null, // si luego agregas slug en DTO, setéalo aquí y valida @@unique([ownerId, slug])
          description: dto.description ?? null,
          status: dto.status ?? undefined,
          visibility: dto.visibility ?? undefined,
          deadline: null,
          repositoryUrl: dto.repositoryUrl ?? null,
          ownerId: user.sub,
        },
      });

      const permissionKeys = Array.from(new Set(DEFAULT_PROJECT_ROLES.flatMap((role) => role.permissions)));
      await ensurePermissionsExist(tx, permissionKeys);
      const permissionIds = await fetchPermissionIds(tx, permissionKeys);

      const createdRoles = await Promise.all(
        DEFAULT_PROJECT_ROLES.map((role) =>
          tx.projectRole.create({
            data: {
              projectId: project.id,
              name: role.name,
              description: role.description ?? null,
              isOwner: role.isOwner,
              isDefault: role.isDefault,
              rolePermissions: {
                create: role.permissions.map((key) => ({
                  permissionId: permissionIds.get(key)!,
                })),
              },
            },
          }),
        ),
      );

      const ownerRole = createdRoles.find((role) => role.isOwner);
      if (!ownerRole) {
        throw new Error('Owner role not created');
      }

      await tx.projectMember.create({
        data: { projectId: project.id, userId: user.sub, roleId: ownerRole.id },
      });

      return project;
    });
  }

  async findMine(user: AccessTokenPayload, query: PaginationDto) {
    const { page, take, skip } = clampPageLimit(query.page, query.limit);
    const orderBy = buildSort(query.sort) ?? { updatedAt: 'desc' as const };
    const text = like(query.q);
    const accessFilter = {
      AND: [
        { deletedAt: null },
        { OR: [{ ownerId: user.sub }, { members: { some: { userId: user.sub } } }] },
      ],
    };
    const textFilter = text ? { OR: [{ name: text }, { description: text }] } : undefined;

    const where = textFilter ? { AND: [accessFilter, textFilter] } : accessFilter;

    const [projects, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          deletedBy: { select: { id: true, name: true, email: true } },
          members: {
            where: { userId: user.sub },
            include: {
              role: {
                include: {
                  rolePermissions: {
                    include: { permission: { select: { key: true } } },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.project.count({ where }),
    ]);

    if (projects.length === 0) {
      return { items: [], total, page, limit: take };
    }

    const projectIds = projects.map((p) => p.id);

    const [rawModules, rawFeatures] = await this.prisma.$transaction([
      this.prisma.module.findMany({
        where: { projectId: { in: projectIds }, deletedAt: null },
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
        where: { module: { projectId: { in: projectIds }, deletedAt: null }, deletedAt: null },
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

    const modules: ModuleRow[] = rawModules.map((mod) => ({
      ...mod,
      documentationLabels: [],
    }));
    const features: FeatureRow[] = rawFeatures.map((feat) => ({
      ...feat,
      documentationLabels: [],
      linkedFeatures: [],
    }));

    const trees = this.buildTreesByProject(modules, features);
    const items = projects.map((project) => {
      const isOwner = project.ownerId === user.sub;
      const membership = project.members[0];
      let hasAccess = false;
      if (isOwner) {
        hasAccess = true;
      } else if (membership?.role) {
        if (membership.role.isOwner) {
          hasAccess = true;
        } else {
          hasAccess = membership.role.rolePermissions.some(
            (rp) => rp.permission.key === PERMISSION_KEYS.PROJECT_READ,
          );
        }
      }
      const { members, ...rest } = project;
      return {
        ...rest,
        hasAccess,
        modules: trees.get(project.id) ?? [],
      };
    });

    return { items, total, page, limit: take };
  }

  async findOne(user: AccessTokenPayload, id: string) {
    const baseProject = await this.ensureCanRead(user, id);

    const project = await this.prisma.project.findFirst({
      where: { id, deletedAt: null },
      include: {
        owner: { select: { id: true, email: true, name: true } },
        members: {
          include: {
            user: { select: { id: true, email: true, name: true } },
            role: { select: { id: true, name: true, isOwner: true } },
          },
        },
        githubCredential: true,
      },
    });

    const membershipRole = await this.resolveProjectRole(user.sub, baseProject);

    return project ? { ...project, membershipRole } : null;
  }

  async getStructure(user: AccessTokenPayload, projectId: string) {
    const project = await this.ensureCanRead(user, projectId);
    const viewerRole = await this.resolveProjectRole(user.sub, project);

    const [rawModules, rawFeatures, labels, documentationFields, preference, featureLinkRows] =
      await this.prisma.$transaction([
        this.prisma.module.findMany({
          where: { projectId, deletedAt: null },
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
          where: { module: { projectId, deletedAt: null }, deletedAt: null },
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
        this.prisma.projectLabel.findMany({
          where: { projectId, deletedAt: null },
          select: {
            id: true,
            name: true,
            isMandatory: true,
            displayOrder: true,
            visibleRoles: { select: { roleId: true } },
          },
          orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        this.prisma.documentationField.findMany({
          where: {
            projectId,
            entityType: {
              in: [
                DocumentationEntityType.MODULE,
                DocumentationEntityType.FEATURE,
                DocumentationEntityType.PROJECT,
              ],
            },
          },
          select: {
            labelId: true,
            entityType: true,
            moduleId: true,
            featureId: true,
            content: true,
            isNotApplicable: true,
            updatedAt: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.userProjectPreference.findUnique({
          where: { userId_projectId: { projectId, userId: user.sub } },
          select: { documentationLabelIds: true },
        }),
        this.prisma.featureLink.findMany({
          where: {
            feature: { module: { projectId, deletedAt: null }, deletedAt: null },
            linkedFeature: { deletedAt: null },
          },
          include: {
            feature: {
              select: {
                id: true,
                name: true,
                module: { select: { id: true, name: true } },
              },
            },
            linkedFeature: {
              select: {
                id: true,
                name: true,
                module: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

    const visibleLabels = this.filterVisibleLabels(
      labels.map((label) => ({
        id: label.id,
        name: label.name,
        isMandatory: label.isMandatory,
        displayOrder: label.displayOrder ?? 0,
        visibleRoleIds: label.visibleRoles.map((entry) => entry.roleId),
      })),
      viewerRole,
    );
    const visibleLabelMap = new Map(visibleLabels.map((label) => [label.id, label]));

    const rawPreferenceIds = preference?.documentationLabelIds ?? [];
    const preferNone = rawPreferenceIds.length === 0;
    const preferredOrder = preferNone
      ? []
      : rawPreferenceIds.filter((id) => visibleLabelMap.has(id));
    const preferredSet = new Set(preferredOrder);
    const preferCustomOrder = preferredOrder.length > 0;
    const preferredOrderMap = new Map(preferredOrder.map((id, index) => [id, index]));

    const moduleDocs = new Map<string, DocumentationLabelSummary[]>();
    const featureDocs = new Map<string, DocumentationLabelSummary[]>();
    const projectDocs: DocumentationLabelSummary[] = [];
    const featureLinksMap = new Map<string, LinkedFeatureSummary[]>();

    if (!preferNone) {
      for (const record of documentationFields) {
        const labelInfo = visibleLabelMap.get(record.labelId);
        if (!labelInfo) continue;
        if (preferCustomOrder && !preferredSet.has(record.labelId)) continue;
        const summary: DocumentationLabelSummary = {
          labelId: record.labelId,
          labelName: labelInfo.name,
          isMandatory: labelInfo.isMandatory,
          displayOrder: labelInfo.order,
          content: record.content ?? null,
          isNotApplicable: record.isNotApplicable,
          updatedAt: record.updatedAt,
        };
        if (record.entityType === DocumentationEntityType.MODULE && record.moduleId) {
          const list = moduleDocs.get(record.moduleId) ?? [];
          list.push(summary);
          moduleDocs.set(record.moduleId, list);
        } else if (record.entityType === DocumentationEntityType.FEATURE && record.featureId) {
          const list = featureDocs.get(record.featureId) ?? [];
          list.push(summary);
          featureDocs.set(record.featureId, list);
        } else if (record.entityType === DocumentationEntityType.PROJECT) {
          projectDocs.push(summary);
        }
      }
    }

    const sortDocumentation = (docs: DocumentationLabelSummary[]) =>
      docs
        .slice()
        .sort((a, b) => {
          if (preferCustomOrder) {
            const orderA = preferredOrderMap.get(a.labelId) ?? Number.MAX_SAFE_INTEGER;
            const orderB = preferredOrderMap.get(b.labelId) ?? Number.MAX_SAFE_INTEGER;
            if (orderA !== orderB) return orderA - orderB;
          }
          if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
          return a.labelName.localeCompare(b.labelName);
        });

    const addLink = (
      sourceId: string,
      target: { id: string; name: string; module: { id: string; name: string } },
      direction: 'references' | 'referenced_by',
      reason: string | null,
    ) => {
      const list = featureLinksMap.get(sourceId) ?? [];
      list.push({
        id: target.id,
        name: target.name,
        moduleId: target.module.id,
        moduleName: target.module.name,
        direction,
        reason,
      });
      featureLinksMap.set(sourceId, list);
    };
    for (const link of featureLinkRows) {
      const linkReason = link.reason ?? null;
      const firstDirection = link.initiatorFeatureId === link.feature.id ? 'references' : 'referenced_by';
      const secondDirection = link.initiatorFeatureId === link.linkedFeature.id ? 'references' : 'referenced_by';
      addLink(link.feature.id, link.linkedFeature, firstDirection, linkReason);
      addLink(link.linkedFeature.id, link.feature, secondDirection, linkReason);
    }

    const sortLinkedFeatures = (items: LinkedFeatureSummary[]) =>
      items
        .slice()
        .sort((a, b) => a.moduleName.localeCompare(b.moduleName) || a.name.localeCompare(b.name));

    const modules: ModuleRow[] = rawModules.map((mod) => ({
      ...mod,
      documentationLabels: sortDocumentation(moduleDocs.get(mod.id) ?? []),
    }));
    const features: FeatureRow[] = rawFeatures.map((feat) => ({
      ...feat,
      documentationLabels: sortDocumentation(featureDocs.get(feat.id) ?? []),
      linkedFeatures: sortLinkedFeatures(featureLinksMap.get(feat.id) ?? []),
    }));

    const modulesTree = this.buildModuleTree(modules, features);

    return {
      projectId,
      description: project.description,
      documentationLabels: sortDocumentation(projectDocs),
      modules: modulesTree,
    };
  }

  async getPublicManual(projectId: string, labelsCsv?: string) {
    return this.buildManualForViewer(projectId, null, labelsCsv);
  }

  async getSharedManual(linkId: string, labelsCsv?: string) {
    const link = await this.prisma.manualShareLink.findUnique({
      where: { id: linkId },
      select: {
        id: true,
        labelIds: true,
        rootType: true,
        rootId: true,
        project: { select: { id: true, name: true, description: true, deletedAt: true } },
      },
    });
    if (!link) throw new NotFoundException('Link not found');
    return this.buildManualForViewer(link.project.id, link.labelIds, labelsCsv, link.project, {
      rootType: link.rootType ?? DocumentationEntityType.PROJECT,
      rootId: link.rootId ?? null,
    });
  }

  async getSharedManualImages(linkId: string, labelId?: string) {
    const link = await this.prisma.manualShareLink.findUnique({
      where: { id: linkId },
      select: {
        id: true,
        labelIds: true,
        rootType: true,
        rootId: true,
        project: { select: { id: true, deletedAt: true } },
      },
    });
    if (!link) throw new NotFoundException('Link not found');
    if (!link.project || link.project.deletedAt) {
      throw new NotFoundException('Project not found');
    }

    const allowedLabelIds = link.labelIds ?? [];
    if (allowedLabelIds.length === 0) {
      return { items: [] };
    }

    if (labelId && !allowedLabelIds.includes(labelId)) {
      throw new BadRequestException('Label not allowed for this share link.');
    }

    const projectId = link.project.id;
    const effectiveRootType = link.rootType ?? DocumentationEntityType.PROJECT;
    const effectiveRootId = link.rootId ?? null;

    let imagesWhere: Prisma.DocumentationImageWhereInput = {
      projectId,
      labelId: labelId ? labelId : { in: allowedLabelIds },
    };

    if (effectiveRootType === DocumentationEntityType.MODULE) {
      if (!effectiveRootId) {
        throw new BadRequestException('Root module is required.');
      }
      const [modules, features] = await this.prisma.$transaction([
        this.prisma.module.findMany({
          where: { projectId, deletedAt: null },
          select: { id: true, parentModuleId: true },
        }),
        this.prisma.feature.findMany({
          where: { module: { projectId, deletedAt: null }, deletedAt: null },
          select: { id: true, moduleId: true },
        }),
      ]);
      const modulesByParent = new Map<string | null, string[]>();
      for (const mod of modules) {
        const parentKey = mod.parentModuleId ?? null;
        const list = modulesByParent.get(parentKey) ?? [];
        list.push(mod.id);
        modulesByParent.set(parentKey, list);
      }
      const allowedModules = new Set<string>();
      const stack = [effectiveRootId];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (allowedModules.has(current)) continue;
        allowedModules.add(current);
        const children = modulesByParent.get(current) ?? [];
        for (const child of children) stack.push(child);
      }
      const allowedFeatures = features
        .filter((feat) => allowedModules.has(feat.moduleId))
        .map((feat) => feat.id);

      imagesWhere = {
        ...imagesWhere,
        OR: [
          { entityType: DocumentationEntityType.MODULE, entityId: { in: Array.from(allowedModules) } },
          { entityType: DocumentationEntityType.FEATURE, entityId: { in: allowedFeatures } },
        ],
      };
    } else if (effectiveRootType === DocumentationEntityType.FEATURE) {
      if (!effectiveRootId) {
        throw new BadRequestException('Root feature is required.');
      }
      const feature = await this.prisma.feature.findFirst({
        where: { id: effectiveRootId, deletedAt: null, module: { projectId, deletedAt: null } },
        select: { id: true, moduleId: true },
      });
      if (!feature) {
        throw new NotFoundException('Root feature not found.');
      }
      imagesWhere = {
        ...imagesWhere,
        OR: [
          { entityType: DocumentationEntityType.MODULE, entityId: feature.moduleId },
          { entityType: DocumentationEntityType.FEATURE, entityId: feature.id },
        ],
      };
    }

    const images = await this.prisma.documentationImage.findMany({
      where: imagesWhere,
      orderBy: [{ labelId: 'asc' }, { createdAt: 'asc' }],
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });

    const imagesByLabel = new Map<string, Array<{ id: string; name: string; url: string; createdAt: Date; createdBy: { id: string; name: string | null; email: string } | null }>>();
    for (const image of images) {
      if (!imagesByLabel.has(image.labelId)) {
        imagesByLabel.set(image.labelId, []);
      }
      imagesByLabel.get(image.labelId)?.push({
        id: image.id,
        name: image.name,
        url: image.url,
        createdAt: image.createdAt,
        createdBy: image.createdBy ?? null,
      });
    }

    const items = Array.from(imagesByLabel.entries()).map(([key, value]) => ({
      labelId: key,
      images: value,
    }));

    return { items };
  }

  async createManualShareLink(
    user: AccessTokenPayload,
    projectId: string,
    labelIds: string[],
    comment?: string,
    rootType?: DocumentationEntityType,
    rootId?: string,
  ) {
    await this.ensureProjectPermission(user.sub, projectId, PERMISSION_KEYS.SHARE_LINKS_MANAGE);
    const normalizedLabelIds = this.normalizeLabelIds(labelIds ?? []);
    const projectLabels = await this.prisma.projectLabel.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true },
    });
    const allowedSet = new Set(projectLabels.map((label) => label.id));
    const sanitized = normalizedLabelIds.filter((id) => allowedSet.has(id));

    const effectiveRootType = rootType ?? DocumentationEntityType.PROJECT;
    let effectiveRootId: string | null = rootId ?? null;
    if (effectiveRootType === DocumentationEntityType.PROJECT) {
      effectiveRootId = null;
    } else if (!effectiveRootId) {
      throw new BadRequestException('rootId is required for this rootType.');
    }

    if (effectiveRootType === DocumentationEntityType.MODULE && effectiveRootId) {
      const module = await this.prisma.module.findFirst({
        where: { id: effectiveRootId, projectId, deletedAt: null },
        select: { id: true },
      });
      if (!module) {
        throw new BadRequestException('Root module not found for this project.');
      }
    }
    if (effectiveRootType === DocumentationEntityType.FEATURE && effectiveRootId) {
      const feature = await this.prisma.feature.findFirst({
        where: { id: effectiveRootId, deletedAt: null, module: { projectId, deletedAt: null } },
        select: { id: true },
      });
      if (!feature) {
        throw new BadRequestException('Root feature not found for this project.');
      }
    }

    const link = await this.prisma.manualShareLink.create({
      data: {
        projectId,
        createdById: user.sub,
        labelIds: sanitized,
        comment: comment?.trim() || null,
        rootType: effectiveRootType === DocumentationEntityType.PROJECT ? null : effectiveRootType,
        rootId: effectiveRootId,
      },
      select: { id: true, labelIds: true, comment: true, rootType: true, rootId: true, createdAt: true },
    });

    await this.touchProject(projectId);
    return {
      id: link.id,
      projectId,
      labelIds: link.labelIds,
      comment: link.comment,
      rootType: link.rootType ?? DocumentationEntityType.PROJECT,
      rootId: link.rootId ?? null,
      createdAt: link.createdAt,
    };
  }

  async listManualShareLinks(
    user: AccessTokenPayload,
    projectId: string,
    scope?: DocumentationEntityType,
    rootId?: string,
  ) {
    await this.ensureProjectPermission(user.sub, projectId, PERMISSION_KEYS.SHARE_LINKS_MANAGE);
    if (!scope && rootId) {
      throw new BadRequestException('Scope is required when rootId is provided.');
    }
    if (scope === DocumentationEntityType.PROJECT && rootId) {
      throw new BadRequestException('rootId is not allowed for project scope.');
    }
    if (
      (scope === DocumentationEntityType.MODULE || scope === DocumentationEntityType.FEATURE) &&
      !rootId
    ) {
      throw new BadRequestException('rootId is required for module or feature scope.');
    }
    if (scope === DocumentationEntityType.MODULE && rootId) {
      const moduleExists = await this.prisma.module.findFirst({
        where: { id: rootId, projectId, deletedAt: null },
        select: { id: true },
      });
      if (!moduleExists) {
        throw new BadRequestException('Root module not found for this project.');
      }
    }
    if (scope === DocumentationEntityType.FEATURE && rootId) {
      const featureExists = await this.prisma.feature.findFirst({
        where: { id: rootId, deletedAt: null, module: { projectId, deletedAt: null } },
        select: { id: true },
      });
      if (!featureExists) {
        throw new BadRequestException('Root feature not found for this project.');
      }
    }

    const where: Prisma.ManualShareLinkWhereInput = { projectId };
    if (scope === DocumentationEntityType.PROJECT) {
      where.rootType = null;
    } else if (scope === DocumentationEntityType.MODULE || scope === DocumentationEntityType.FEATURE) {
      where.rootType = scope;
      where.rootId = rootId ?? undefined;
    }

    const [links, labels] = await this.prisma.$transaction([
      this.prisma.manualShareLink.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: { id: true, labelIds: true, comment: true, rootType: true, rootId: true, createdAt: true },
      }),
      this.prisma.projectLabel.findMany({
        where: { projectId, deletedAt: null },
        select: { id: true, name: true, isMandatory: true, displayOrder: true },
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    const labelInfoMap = new Map(
      labels.map((label) => [
        label.id,
        { id: label.id, name: label.name, isMandatory: label.isMandatory, order: label.displayOrder ?? 0 },
      ]),
    );
    const items = links.map((link) => ({
      id: link.id,
      labelIds: link.labelIds,
      labels: link.labelIds
        .map((id) => labelInfoMap.get(id))
        .filter((value): value is VisibleDocumentationLabel => value !== undefined),
      comment: link.comment,
      rootType: link.rootType ?? DocumentationEntityType.PROJECT,
      rootId: link.rootId ?? null,
      createdAt: link.createdAt,
    }));

    return { items };
  }

  async revokeManualShareLink(user: AccessTokenPayload, projectId: string, linkId: string) {
    await this.ensureProjectPermission(user.sub, projectId, PERMISSION_KEYS.SHARE_LINKS_MANAGE);
    const link = await this.prisma.manualShareLink.findUnique({
      where: { id: linkId },
      select: { id: true, projectId: true },
    });
    if (!link || link.projectId !== projectId) throw new NotFoundException('Link not found');

    await this.prisma.manualShareLink.delete({ where: { id: linkId } });
    await this.touchProject(projectId);
    return { ok: true };
  }

  async listVisibleDocumentationLabelsForUser(user: AccessTokenPayload, projectId: string) {
    const project = await this.ensureCanRead(user, projectId);
    const role = await this.resolveProjectRole(user.sub, project);
    return this.loadVisibleLabelsForRole(projectId, role);
  }

  async getDocumentationLabelPreferences(
    user: AccessTokenPayload,
    projectId: string,
  ): Promise<DocumentationLabelPreferencePayload> {
    const project = await this.ensureCanRead(user, projectId);
    const role = await this.resolveProjectRole(user.sub, project);
    const availableLabels = await this.loadVisibleLabelsForRole(projectId, role);
    const visibleSet = new Set(availableLabels.map((label) => label.id));
    const preference = await this.prisma.userProjectPreference.findUnique({
      where: { userId_projectId: { projectId, userId: user.sub } },
      select: { documentationLabelIds: true },
    });
    const selectedLabelIds = (preference?.documentationLabelIds ?? []).filter((id) =>
      visibleSet.has(id),
    );
    return { projectId, availableLabels, selectedLabelIds };
  }

  async updateDocumentationLabelPreferences(
    user: AccessTokenPayload,
    projectId: string,
    labelIds: string[],
  ): Promise<DocumentationLabelPreferencePayload> {
    const project = await this.ensureCanRead(user, projectId);
    const role = await this.resolveProjectRole(user.sub, project);
    const availableLabels = await this.loadVisibleLabelsForRole(projectId, role);
    const visibleSet = new Set(availableLabels.map((label) => label.id));
    const sanitizedIds = Array.from(new Set(labelIds.filter((id) => visibleSet.has(id))));

    await this.prisma.userProjectPreference.upsert({
      where: { userId_projectId: { projectId, userId: user.sub } },
      create: {
        projectId,
        userId: user.sub,
        documentationLabelIds: sanitizedIds,
      },
      update: {
        documentationLabelIds: sanitizedIds,
      },
    });

    await this.touchProject(projectId);
    return { projectId, availableLabels, selectedLabelIds: sanitizedIds };
  }

  async update(user: AccessTokenPayload, id: string, dto: UpdateProjectDto) {
    const project = await this.ensureProjectPermission(user.sub, id, PERMISSION_KEYS.PROJECT_UPDATE);

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
    await this.ensureProjectPermission(user.sub, id, PERMISSION_KEYS.PROJECT_DELETE);
    const project = await this.getProjectOrThrow(id);
    const deletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id },
        data: { deletedAt, deletedById: user.sub },
      });
      await tx.module.updateMany({
        where: { projectId: id, deletedAt: null },
        data: { deletedAt, deletedById: user.sub },
      });
      await tx.feature.updateMany({
        where: { module: { projectId: id }, deletedAt: null },
        data: { deletedAt, deletedById: user.sub },
      });
      await tx.projectLabel.updateMany({
        where: { projectId: id, deletedAt: null },
        data: { deletedAt, deletedById: user.sub },
      });
    });
    return { ok: true, deletedProjectId: project.id };
  }

  async listDeleted(user: AccessTokenPayload, query: PaginationDto) {
    const { page, take, skip } = clampPageLimit(query.page, query.limit);
    const orderBy = buildSort(query.sort) ?? { deletedAt: 'desc' as const };
    const text = like(query.q);
    const accessFilter = {
      AND: [
        { deletedAt: { not: null } },
        { OR: [{ ownerId: user.sub }, { members: { some: { userId: user.sub } } }] },
      ],
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

    return { items: projects, total, page, limit: take };
  }

  async restore(user: AccessTokenPayload, id: string) {
    const project = await this.getProjectOrThrow(id, { includeDeleted: true });
    if (!project.deletedAt) {
      throw new ConflictException('Project is not deleted');
    }
    await this.ensureProjectPermission(user.sub, id, PERMISSION_KEYS.PROJECT_DELETE, { includeDeleted: true });
    const cutoff = project.deletedAt;

    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id },
        data: { deletedAt: null, deletedById: null },
      });
      await tx.module.updateMany({
        where: { projectId: id, deletedAt: { gte: cutoff } },
        data: { deletedAt: null, deletedById: null },
      });
      await tx.feature.updateMany({
        where: { module: { projectId: id }, deletedAt: { gte: cutoff } },
        data: { deletedAt: null, deletedById: null },
      });
      await tx.projectLabel.updateMany({
        where: { projectId: id, deletedAt: { gte: cutoff } },
        data: { deletedAt: null, deletedById: null },
      });
    });

    return { ok: true, restoredProjectId: id };
  }

  /** === Members (owner-only) === */
  async addMember(
    user: AccessTokenPayload,
    projectId: string,
    memberEmail: string,
    roleId?: string,
  ) {
    const p = await this.ensureProjectPermission(
      user.sub,
      projectId,
      PERMISSION_KEYS.PROJECT_MANAGE_MEMBERS,
    );
    const normalizedEmail = memberEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      throw new BadRequestException('Email requerido');
    }
    const member = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (!member) {
      throw new NotFoundException('Usuario no encontrado');
    }
    if (member.id === p.ownerId) {
      throw new ConflictException('Owner ya es miembro implícito');
    }

    const assignedRoleId = roleId ?? (await this.getDefaultRoleId(projectId));
    const role = await this.prisma.projectRole.findFirst({
      where: { id: assignedRoleId, projectId },
      select: { id: true, isOwner: true },
    });
    if (!role) {
      throw new BadRequestException('Rol inválido para este proyecto');
    }
    if (role.isOwner) {
      throw new BadRequestException('No puedes asignar el rol owner');
    }

    const result = await this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: member.id } },
      create: { projectId, userId: member.id, roleId: role.id },
      update: { roleId: role.id },
    });
    await this.touchProject(projectId);
    return result;
  }

  async updateMemberRole(
    user: AccessTokenPayload,
    projectId: string,
    memberUserId: string,
    roleId: string,
  ) {
    const p = await this.ensureProjectPermission(
      user.sub,
      projectId,
      PERMISSION_KEYS.PROJECT_MANAGE_MEMBERS,
    );
    if (memberUserId === p.ownerId) {
      throw new ConflictException('No puedes cambiar el rol del owner');
    }

    const role = await this.prisma.projectRole.findFirst({
      where: { id: roleId, projectId },
      select: { id: true, isOwner: true },
    });
    if (!role) {
      throw new BadRequestException('Rol inválido para este proyecto');
    }
    if (role.isOwner) {
      throw new BadRequestException('No puedes asignar el rol owner');
    }

    const result = await this.prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId: memberUserId } },
      data: { roleId: role.id },
    });
    await this.touchProject(projectId);
    return result;
  }

  async removeMember(user: AccessTokenPayload, projectId: string, memberUserId: string) {
    const p = await this.ensureProjectPermission(
      user.sub,
      projectId,
      PERMISSION_KEYS.PROJECT_MANAGE_MEMBERS,
    );
    if (memberUserId === p.ownerId) {
      throw new ConflictException('No puedes remover al owner');
    }

    await this.prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: memberUserId } },
    });
    await this.touchProject(projectId);
    return { ok: true };
  }

  /** === Roles (owner/maintainer) === */
  async listRoles(user: AccessTokenPayload, projectId: string) {
    await this.ensureProjectPermission(user.sub, projectId, PERMISSION_KEYS.PROJECT_READ);
    const roles = await this.prisma.projectRole.findMany({
      where: { projectId },
      orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }],
      include: {
        rolePermissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { members: true } },
      },
    });
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isOwner: role.isOwner,
      isDefault: role.isDefault,
      permissionKeys: role.rolePermissions.map((rp) => rp.permission.key),
      memberCount: role._count.members,
    }));
  }

  async listPermissions(user: AccessTokenPayload, projectId: string) {
    await this.ensureProjectPermission(user.sub, projectId, PERMISSION_KEYS.PROJECT_READ);
    await ensurePermissionsExist(this.prisma, Object.values(PERMISSION_KEYS) as PermissionKey[]);
    const permissions = await this.prisma.permission.findMany({
      orderBy: { key: 'asc' },
      select: { key: true, description: true },
    });
    return { items: permissions };
  }

  async createRole(
    user: AccessTokenPayload,
    projectId: string,
    dto: { name: string; description?: string; permissionKeys: string[] },
  ) {
    await this.ensureProjectPermission(user.sub, projectId, PERMISSION_KEYS.PROJECT_MANAGE_ROLES);
    const permissionKeys = this.normalizePermissionKeys(dto.permissionKeys ?? []);
    await ensurePermissionsExist(this.prisma, permissionKeys);
    const permissionIds = await fetchPermissionIds(this.prisma, permissionKeys);
    const created = await this.prisma.projectRole.create({
      data: {
        projectId,
        name: dto.name.trim(),
        description: dto.description?.trim() ?? null,
        isOwner: false,
        isDefault: false,
        rolePermissions: {
          create: permissionKeys.map((key) => ({ permissionId: permissionIds.get(key)! })),
        },
      },
      include: {
        rolePermissions: { select: { permission: { select: { key: true } } } },
      },
    });
    await this.touchProject(projectId);
    return {
      id: created.id,
      name: created.name,
      description: created.description,
      isOwner: created.isOwner,
      isDefault: created.isDefault,
      permissionKeys: created.rolePermissions.map((rp) => rp.permission.key),
    };
  }

  async updateRole(
    user: AccessTokenPayload,
    projectId: string,
    roleId: string,
    dto: { name?: string; description?: string; permissionKeys?: string[] },
  ) {
    await this.ensureProjectPermission(user.sub, projectId, PERMISSION_KEYS.PROJECT_MANAGE_ROLES);
    const role = await this.prisma.projectRole.findFirst({
      where: { id: roleId, projectId },
      select: { id: true, isOwner: true },
    });
    if (!role) throw new NotFoundException('Rol no encontrado');
    if (
      role.isOwner &&
      (dto.name !== undefined || dto.description !== undefined || dto.permissionKeys !== undefined)
    ) {
      throw new ConflictException('No puedes editar el rol owner');
    }

    const data: Prisma.ProjectRoleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() ?? null;
    if (dto.permissionKeys !== undefined) {
      const permissionKeys = this.normalizePermissionKeys(dto.permissionKeys);
      await ensurePermissionsExist(this.prisma, permissionKeys);
      const permissionIds = await fetchPermissionIds(this.prisma, permissionKeys);
      data.rolePermissions = {
        deleteMany: {},
        create: permissionKeys.map((key) => ({ permissionId: permissionIds.get(key)! })),
      };
    }

    const updated = await this.prisma.projectRole.update({
      where: { id: role.id },
      data,
      include: {
        rolePermissions: { select: { permission: { select: { key: true } } } },
      },
    });
    await this.touchProject(projectId);
    return {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      isOwner: updated.isOwner,
      isDefault: updated.isDefault,
      permissionKeys: updated.rolePermissions.map((rp) => rp.permission.key),
    };
  }

  async deleteRole(user: AccessTokenPayload, projectId: string, roleId: string) {
    await this.ensureProjectPermission(user.sub, projectId, PERMISSION_KEYS.PROJECT_MANAGE_ROLES);
    const role = await this.prisma.projectRole.findFirst({
      where: { id: roleId, projectId },
      select: { id: true, isOwner: true },
    });
    if (!role) throw new NotFoundException('Rol no encontrado');
    if (role.isOwner) {
      throw new ConflictException('No puedes eliminar el rol owner');
    }

    const membersCount = await this.prisma.projectMember.count({
      where: { projectId, roleId: role.id },
    });
    if (membersCount > 0) {
      throw new ConflictException('No puedes eliminar un rol con miembros asignados');
    }

    await this.prisma.projectRole.delete({ where: { id: role.id } });
    await this.touchProject(projectId);
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
    await this.ensureProjectPermission(
      user.sub,
      projectId,
      PERMISSION_KEYS.PROJECT_MANAGE_INTEGRATIONS,
    );

    const credential = await this.prisma.projectGithubCredential.upsert({
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
    await this.touchProject(projectId);
    return credential;
  }

  async deleteProjectGithubCredential(user: AccessTokenPayload, projectId: string) {
    await this.ensureProjectPermission(
      user.sub,
      projectId,
      PERMISSION_KEYS.PROJECT_MANAGE_INTEGRATIONS,
    );
    try {
      await this.prisma.projectGithubCredential.delete({ where: { projectId } });
    } catch {
      // idempotente
    }
    await this.touchProject(projectId);
    return { ok: true };
  }
}
