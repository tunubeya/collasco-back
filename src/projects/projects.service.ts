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
import { DocumentationEntityType, ProjectMemberRole, Visibility } from '@prisma/client';

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
      return ProjectMemberRole.OWNER;
    }
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId } },
      select: { role: true },
    });
    return membership?.role ?? ProjectMemberRole.VIEWER;
  }

  private canViewDocumentationLabel(
    role: ProjectMemberRole,
    visibleToRoles?: ProjectMemberRole[] | null,
  ): boolean {
    if (role === ProjectMemberRole.OWNER) {
      return true;
    }
    if (!visibleToRoles || visibleToRoles.length === 0) {
      return true;
    }
    return visibleToRoles.includes(role);
  }

  private filterVisibleLabels(
    labels: Array<{
      id: string;
      name: string;
      isMandatory: boolean;
      visibleToRoles: ProjectMemberRole[] | null;
      displayOrder: number;
    }>,
    role: ProjectMemberRole,
  ): VisibleDocumentationLabel[] {
    return labels
      .filter((label) => this.canViewDocumentationLabel(role, label.visibleToRoles ?? []))
      .map((label) => ({
        id: label.id,
        name: label.name,
        isMandatory: label.isMandatory,
        order: label.displayOrder ?? 0,
      }));
  }

  private async loadVisibleLabelsForRole(projectId: string, role: ProjectMemberRole) {
    const labels = await this.prisma.projectLabel.findMany({
      where: { projectId, deletedAt: null },
      select: {
        id: true,
        name: true,
        isMandatory: true,
        displayOrder: true,
        visibleToRoles: true,
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return this.filterVisibleLabels(labels, role);
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
            visibleToRoles: true,
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
      } else if (record.entityType === DocumentationEntityType.PROJECT) {
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
      project: { id: project.id, name: project.name, description: project.description },
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
    if (p.ownerId === user.sub) return p;

    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: user.sub } },
    });
    if (!member) throw new ForbiddenException('Forbidden');
    return p;
  }

  private async ensureOwner(userId: string, projectId: string, opts: { includeDeleted?: boolean } = {}) {
    const p = await this.getProjectOrThrow(projectId, opts);
    if (p.ownerId !== userId) throw new ForbiddenException('Owner only');
    return p;
  }

  private async ensureOwnerOrMaintainer(
    userId: string,
    projectId: string,
    opts: { includeDeleted?: boolean } = {},
  ) {
    const project = await this.getProjectOrThrow(projectId, opts);
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
    const items = projects.map((project) => ({
      ...project,
      modules: trees.get(project.id) ?? [],
    }));

    return { items, total, page, limit: take };
  }

  async findOne(user: AccessTokenPayload, id: string) {
    const baseProject = await this.ensureCanRead(user, id);

    const project = await this.prisma.project.findFirst({
      where: { id, deletedAt: null },
      include: {
        owner: { select: { id: true, email: true, name: true } },
        members: {
          include: { user: { select: { id: true, email: true, name: true } } },
        },
        githubCredential: true,
      },
    });

    let membershipRole: ProjectMemberRole | null = null;
    if (baseProject.ownerId === user.sub) {
      membershipRole = ProjectMemberRole.OWNER;
    } else {
      const membership = await this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: id, userId: user.sub } },
        select: { role: true },
      });
      membershipRole = membership?.role ?? null;
    }

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
            visibleToRoles: true,
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
        visibleToRoles: label.visibleToRoles ?? [],
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
        project: { select: { id: true, name: true, description: true, deletedAt: true } },
      },
    });
    if (!link) throw new NotFoundException('Link not found');
    return this.buildManualForViewer(link.project.id, link.labelIds, labelsCsv, link.project);
  }

  async createManualShareLink(user: AccessTokenPayload, projectId: string, labelIds: string[]) {
    await this.ensureOwnerOrMaintainer(user.sub, projectId);
    const normalizedLabelIds = this.normalizeLabelIds(labelIds ?? []);
    const projectLabels = await this.prisma.projectLabel.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true },
    });
    const allowedSet = new Set(projectLabels.map((label) => label.id));
    const sanitized = normalizedLabelIds.filter((id) => allowedSet.has(id));

    const link = await this.prisma.manualShareLink.create({
      data: {
        projectId,
        createdById: user.sub,
        labelIds: sanitized,
      },
      select: { id: true, labelIds: true, createdAt: true },
    });

    return {
      id: link.id,
      projectId,
      labelIds: link.labelIds,
      createdAt: link.createdAt,
    };
  }

  async listManualShareLinks(user: AccessTokenPayload, projectId: string) {
    await this.ensureOwnerOrMaintainer(user.sub, projectId);
    const [links, labels] = await this.prisma.$transaction([
      this.prisma.manualShareLink.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, labelIds: true, createdAt: true },
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
      createdAt: link.createdAt,
    }));

    return { items };
  }

  async revokeManualShareLink(user: AccessTokenPayload, projectId: string, linkId: string) {
    await this.ensureOwnerOrMaintainer(user.sub, projectId);
    const link = await this.prisma.manualShareLink.findUnique({
      where: { id: linkId },
      select: { id: true, projectId: true },
    });
    if (!link || link.projectId !== projectId) throw new NotFoundException('Link not found');

    await this.prisma.manualShareLink.delete({ where: { id: linkId } });
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

    return { projectId, availableLabels, selectedLabelIds: sanitizedIds };
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
    await this.ensureOwnerOrMaintainer(user.sub, id, { includeDeleted: true });
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
