import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DocumentationEntityType,
  Prisma,
  ProjectMemberRole,
  TestEvaluation,
  TestRunStatus,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTestCasesDto } from './dto/create-test-cases.dto';
import { UpdateTestCaseDto } from './dto/update-test-case.dto';
import { CreateTestRunDto, TestResultInput } from './dto/create-test-run.dto';
import { UpsertResultsDto } from './dto/upsert-results.dto';
import { assertProjectRead, assertProjectWrite } from './guards/rbac.helpers';
import { CreateProjectTestRunDto } from './dto/create-project-test-run.dto';
import { UpdateTestRunDto } from './dto/update-test-run.dto';
import { UpdateLinkedFeatureDto } from './dto/update-linked-feature.dto';

const testRunDetailInclude: Prisma.TestRunInclude = {
  feature: {
    select: {
      id: true,
      name: true,
      module: {
        select: {
          id: true,
          name: true,
          projectId: true,
        },
      },
    },
  },
  project: {
    select: {
      id: true,
      name: true,
    },
  },
  runBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  results: {
    include: {
      testCase: {
        include: {
          feature: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  },
};

type RunCoverage = {
  scope: 'FEATURE' | 'PROJECT';
  totalCases: number;
  executedCases: number;
  missingCases: number;
  missingTestCases: Array<{
    id: string;
    name: string;
    featureId: string;
    featureName: string;
  }>;
};

type TestRunRecord = Prisma.TestRunGetPayload<{
  include: typeof testRunDetailInclude;
}>;

type TestRunDetail = TestRunRecord & { coverage: RunCoverage };

type ProjectDashboardMetrics = {
  totalFeatures: number;
  featuresMissingDescription: number;
  featuresWithoutTestCases: number;
  featuresWithRuns: number;
  testCoverageRatio: number | null;
  openRuns: number;
  runsWithFullPass: number;
};

type MissingDescriptionItem = {
  id: string;
  name: string;
  entityType: 'FEATURE' | 'MODULE';
};

type ProjectDashboardReports = {
  featuresMissingDescription: MissingDescriptionItem[];
  featuresWithoutTestCases: Array<{ id: string; name: string }>;
  featureCoverage: Array<{
    featureId: string;
    featureName: string;
    totalTestCases: number;
    executedTestCases: number;
    missingTestCases: number;
    coverageRatio: number | null;
    latestRun: {
      id: string;
      runDate: Date;
      status: TestRunStatus;
    } | null;
  }>;
  featureHealth: Array<{
    featureId: string;
    featureName: string;
    passRate: number | null;
    executedTestCases: number;
    passedTestCases: number;
    failedTestCases: number;
    hasMissingTestCases: boolean;
    missingTestCasesCount: number;
    latestRun: {
      id: string;
      runDate: Date;
      status: TestRunStatus;
    } | null;
  }>;
  openRuns: Array<{
    id: string;
    runDate: Date;
    environment: string | null;
    status: TestRunStatus;
    feature: { id: string; name: string } | null;
    runBy: string | null;
  }>;
  runsWithFullPass: Array<{
    id: string;
    runDate: Date;
    feature: { id: string; name: string } | null;
    coverage: RunCoverage;
  }>;
};

type ProjectDashboardData = {
  metrics: ProjectDashboardMetrics;
  reports: ProjectDashboardReports;
};

type LinkedFeatureSummary = {
  id: string;
  name: string;
  moduleId: string;
  moduleName: string;
  reason: string | null;
  direction: 'references' | 'referenced_by';
};

type ProjectLabelView = {
  id: string;
  name: string;
  isMandatory: boolean;
  defaultNotApplicable: boolean;
  visibleToRoles: ProjectMemberRole[];
  readOnlyRoles: ProjectMemberRole[];
  displayOrder: number;
};

type DocumentationEntry = {
  label: ProjectLabelView;
  field:
    | {
        id: string;
        content: string | null;
        isNotApplicable: boolean;
        updatedAt: Date;
      }
    | null;
  canEdit: boolean;
};

type PaginationInput = {
  page: number;
  pageSize: number;
};

type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

type ListQueryOptions = {
  pagination: PaginationInput;
  filters?: Record<string, string | undefined>;
  sort?: string;
};

@Injectable()
export class QaService {
  private readonly logger = new Logger(QaService.name);
  private static readonly EVALUATIONS: TestEvaluation[] = [
    TestEvaluation.NOT_STARTED,
    TestEvaluation.NOT_WORKING,
    TestEvaluation.MINOR_ISSUE,
    TestEvaluation.PASSED,
  ];
  private static readonly WRITE_ROLES = new Set<ProjectMemberRole>([
    ProjectMemberRole.OWNER,
    ProjectMemberRole.MAINTAINER,
    ProjectMemberRole.DEVELOPER,
  ]);

  constructor(private readonly prisma: PrismaService) {}

  async getProjectIdByFeature(featureId: string): Promise<string | null> {
    const feature = await this.prisma.feature.findUnique({
      where: { id: featureId },
      select: {
        module: {
          select: { projectId: true },
        },
      },
    });
    return feature?.module.projectId ?? null;
  }

  async createTestCases(userId: string, featureId: string, dto: CreateTestCasesDto) {
    const projectId = await this.getProjectIdOrThrow(featureId);
    await assertProjectWrite(this.prisma, userId, projectId);

    await this.prisma.testCase.createMany({
      data: dto.cases.map((testCase) => ({
        featureId,
        name: testCase.name,
        steps: testCase.steps,
        expected: testCase.expected,
      })),
      skipDuplicates: true,
    });

    return this.prisma.testCase.findMany({
      where: { featureId, isArchived: false },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listTestCases(userId: string, featureId: string, includeArchived: boolean) {
    const projectId = await this.getProjectIdOrThrow(featureId);
    await assertProjectRead(this.prisma, userId, projectId);

    return this.prisma.testCase.findMany({
      where: {
        featureId,
        ...(includeArchived ? {} : { isArchived: false }),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listProjectLabels(userId: string, projectId: string): Promise<ProjectLabelView[]> {
    await assertProjectRead(this.prisma, userId, projectId);
    const labels = await this.prisma.projectLabel.findMany({
      where: { projectId },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return labels.map((label) => this.mapProjectLabel(label));
  }

  async createProjectLabel(
    userId: string,
    projectId: string,
    dto: {
      name: string;
      isMandatory?: boolean;
      defaultNotApplicable?: boolean;
      visibleToRoles?: ProjectMemberRole[];
      readOnlyRoles?: ProjectMemberRole[];
    },
  ): Promise<ProjectLabelView> {
    await this.assertProjectOwner(userId, projectId);
    const lastLabel = await this.prisma.projectLabel.findFirst({
      where: { projectId },
      orderBy: { displayOrder: 'desc' },
      select: { displayOrder: true },
    });
    const nextOrder = (lastLabel?.displayOrder ?? 0) + 1;
    const created = await this.prisma.projectLabel.create({
      data: {
        projectId,
        name: dto.name.trim(),
        isMandatory: dto.isMandatory ?? false,
        defaultNotApplicable: dto.defaultNotApplicable ?? false,
        displayOrder: nextOrder,
        visibleToRoles: dto.visibleToRoles ?? [],
        readOnlyRoles: dto.readOnlyRoles ?? [],
      },
    });
    if (created.defaultNotApplicable) {
      await this.createDefaultDocumentationForLabel(projectId, created.id);
    }
    return this.mapProjectLabel(created);
  }

  async updateProjectLabel(
    userId: string,
    projectId: string,
    labelId: string,
    dto: {
      name?: string;
      isMandatory?: boolean;
      defaultNotApplicable?: boolean;
      visibleToRoles?: ProjectMemberRole[];
      readOnlyRoles?: ProjectMemberRole[];
    },
  ): Promise<ProjectLabelView> {
    await this.assertProjectOwner(userId, projectId);
    const label = await this.prisma.projectLabel.findUnique({
      where: { id: labelId },
      select: { projectId: true, defaultNotApplicable: true },
    });
    if (!label || label.projectId !== projectId) {
      throw new NotFoundException('Label not found.');
    }
    const data: Prisma.ProjectLabelUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.isMandatory !== undefined) data.isMandatory = dto.isMandatory;
    if (dto.defaultNotApplicable !== undefined) data.defaultNotApplicable = dto.defaultNotApplicable;
    if (dto.visibleToRoles !== undefined) data.visibleToRoles = dto.visibleToRoles;
    if (dto.readOnlyRoles !== undefined) data.readOnlyRoles = dto.readOnlyRoles;
    const updated = await this.prisma.projectLabel.update({
      where: { id: labelId },
      data,
    });
    if (dto.defaultNotApplicable === true && !label.defaultNotApplicable) {
      await this.createDefaultDocumentationForLabel(projectId, labelId);
    }
    return this.mapProjectLabel(updated);
  }

  async deleteProjectLabel(userId: string, projectId: string, labelId: string): Promise<void> {
    await this.assertProjectOwner(userId, projectId);
    const label = await this.prisma.projectLabel.findUnique({
      where: { id: labelId },
      select: { projectId: true },
    });
    if (!label || label.projectId !== projectId) {
      throw new NotFoundException('Label not found.');
    }
    await this.prisma.projectLabel.delete({ where: { id: labelId } });
  }

  async reorderProjectLabel(userId: string, projectId: string, labelId: string, newIndex: number): Promise<ProjectLabelView[]> {
    await this.assertProjectOwner(userId, projectId);
    const labels = await this.prisma.projectLabel.findMany({
      where: { projectId },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    const currentIndex = labels.findIndex((label) => label.id === labelId);
    if (currentIndex === -1) {
      throw new NotFoundException('Label not found.');
    }
    const clampedIndex = Math.max(0, Math.min(newIndex, labels.length - 1));
    const [label] = labels.splice(currentIndex, 1);
    labels.splice(clampedIndex, 0, label);

    await this.prisma.$transaction(
      labels.map((entry, index) =>
        this.prisma.projectLabel.update({
          where: { id: entry.id },
          data: { displayOrder: index },
        }),
      ),
    );

    const reordered = await this.prisma.projectLabel.findMany({
      where: { projectId },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return reordered.map((labelRow) => this.mapProjectLabel(labelRow));
  }

  async listFeatureDocumentation(userId: string, featureId: string): Promise<DocumentationEntry[]> {
    const projectId = await this.getProjectIdOrThrow(featureId);
    await assertProjectRead(this.prisma, userId, projectId);
    return this.listDocumentationEntries({
      userId,
      projectId,
      entityType: DocumentationEntityType.FEATURE,
      entityId: featureId,
    });
  }

  async listModuleDocumentation(userId: string, moduleId: string): Promise<DocumentationEntry[]> {
    const projectId = await this.getProjectIdByModuleOrThrow(moduleId);
    await assertProjectRead(this.prisma, userId, projectId);
    return this.listDocumentationEntries({
      userId,
      projectId,
      entityType: DocumentationEntityType.MODULE,
      entityId: moduleId,
    });
  }

  async upsertFeatureDocumentation(
    userId: string,
    featureId: string,
    labelId: string,
    dto: { content?: string; isNotApplicable?: boolean },
  ): Promise<DocumentationEntry[]> {
    const projectId = await this.getProjectIdOrThrow(featureId);
    await assertProjectWrite(this.prisma, userId, projectId);
    await this.upsertDocumentationField({
      userId,
      projectId,
      entityType: DocumentationEntityType.FEATURE,
      entityId: featureId,
      labelId,
      dto,
    });
    return this.listFeatureDocumentation(userId, featureId);
  }

  async upsertModuleDocumentation(
    userId: string,
    moduleId: string,
    labelId: string,
    dto: { content?: string; isNotApplicable?: boolean },
  ): Promise<DocumentationEntry[]> {
    const projectId = await this.getProjectIdByModuleOrThrow(moduleId);
    await assertProjectWrite(this.prisma, userId, projectId);
    await this.upsertDocumentationField({
      userId,
      projectId,
      entityType: DocumentationEntityType.MODULE,
      entityId: moduleId,
      labelId,
      dto,
    });
    return this.listModuleDocumentation(userId, moduleId);
  }

  async listLinkedFeatures(userId: string, featureId: string): Promise<LinkedFeatureSummary[]> {
    const projectId = await this.getProjectIdOrThrow(featureId);
    await assertProjectRead(this.prisma, userId, projectId);

    const links = await this.prisma.featureLink.findMany({
      where: {
        OR: [{ featureId }, { linkedFeatureId: featureId }],
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
      orderBy: { createdAt: 'desc' },
    });

    return links.map((link) => {
      const other =
        link.featureId === featureId
          ? link.linkedFeature
          : link.feature;
      const direction =
        link.initiatorFeatureId === featureId ? 'references' : 'referenced_by';
      return {
        id: other.id,
        name: other.name,
        moduleId: other.module.id,
        moduleName: other.module.name,
        reason: link.reason ?? null,
        direction,
      };
    });
  }

  async linkFeatures(
    userId: string,
    featureId: string,
    targetFeatureId: string,
    reason?: string,
  ): Promise<LinkedFeatureSummary[]> {
    if (featureId === targetFeatureId) {
      throw new BadRequestException('Cannot link a feature to itself.');
    }

    const [projectId, targetProjectId] = await Promise.all([
      this.getProjectIdOrThrow(featureId),
      this.getProjectIdOrThrow(targetFeatureId),
    ]);
    if (projectId !== targetProjectId) {
      throw new BadRequestException('Linked features must belong to the same project.');
    }

    await assertProjectWrite(this.prisma, userId, projectId);

    const pair = this.normalizeFeatureLinkPair(featureId, targetFeatureId);
    await this.prisma.featureLink.upsert({
      where: {
        featureId_linkedFeatureId: {
          featureId: pair.featureId,
          linkedFeatureId: pair.linkedFeatureId,
        },
      },
      update: {
        ...(reason !== undefined ? { reason } : {}),
        initiatorFeatureId: featureId,
      },
      create: {
        featureId: pair.featureId,
        linkedFeatureId: pair.linkedFeatureId,
        reason: reason ?? null,
        initiatorFeatureId: featureId,
      },
    });

    return this.listLinkedFeatures(userId, featureId);
  }

  async updateLinkedFeature(
    userId: string,
    featureId: string,
    linkedFeatureId: string,
    dto: UpdateLinkedFeatureDto,
  ): Promise<LinkedFeatureSummary[]> {
    if (featureId === linkedFeatureId) {
      throw new BadRequestException('Cannot update a self link.');
    }

    const [projectId, linkedProjectId] = await Promise.all([
      this.getProjectIdOrThrow(featureId),
      this.getProjectIdOrThrow(linkedFeatureId),
    ]);
    if (projectId !== linkedProjectId) {
      throw new BadRequestException('Linked features must belong to the same project.');
    }
    await assertProjectWrite(this.prisma, userId, projectId);

    const pair = this.normalizeFeatureLinkPair(featureId, linkedFeatureId);
    const existing = await this.prisma.featureLink.findUnique({
      where: {
        featureId_linkedFeatureId: {
          featureId: pair.featureId,
          linkedFeatureId: pair.linkedFeatureId,
        },
      },
    });
    if (!existing) {
      throw new NotFoundException('Linked feature relationship not found.');
    }

    const targetFeatureId = dto.targetFeatureId ?? linkedFeatureId;
    const targetChanged = targetFeatureId !== linkedFeatureId;
    const nextReason =
      dto.reason !== undefined ? dto.reason : existing.reason ?? null;

    if (targetFeatureId === featureId) {
      throw new BadRequestException('Cannot link a feature to itself.');
    }

    if (targetChanged) {
      const newTargetProjectId = await this.getProjectIdOrThrow(targetFeatureId);
      if (newTargetProjectId !== projectId) {
        throw new BadRequestException('Linked features must belong to the same project.');
      }

      const newPair = this.normalizeFeatureLinkPair(featureId, targetFeatureId);
      await this.prisma.$transaction([
        this.prisma.featureLink.deleteMany({
          where: {
            featureId: pair.featureId,
            linkedFeatureId: pair.linkedFeatureId,
          },
        }),
        this.prisma.featureLink.upsert({
          where: {
            featureId_linkedFeatureId: {
              featureId: newPair.featureId,
              linkedFeatureId: newPair.linkedFeatureId,
            },
          },
          update: {
            reason: nextReason,
            initiatorFeatureId: featureId,
          },
          create: {
            featureId: newPair.featureId,
            linkedFeatureId: newPair.linkedFeatureId,
            reason: nextReason,
            initiatorFeatureId: featureId,
          },
        }),
      ]);
    } else {
      await this.prisma.featureLink.update({
        where: {
          featureId_linkedFeatureId: {
            featureId: pair.featureId,
            linkedFeatureId: pair.linkedFeatureId,
          },
        },
        data: {
          reason: nextReason,
          initiatorFeatureId: featureId,
        },
      });
    }

    return this.listLinkedFeatures(userId, featureId);
  }

  async unlinkFeatures(
    userId: string,
    featureId: string,
    linkedFeatureId: string,
  ): Promise<LinkedFeatureSummary[]> {
    if (featureId === linkedFeatureId) {
      throw new BadRequestException('Cannot remove a self link.');
    }
    const projectId = await this.getProjectIdOrThrow(featureId);
    await assertProjectWrite(this.prisma, userId, projectId);

    const pair = this.normalizeFeatureLinkPair(featureId, linkedFeatureId);
    const result = await this.prisma.featureLink.deleteMany({
      where: {
        featureId: pair.featureId,
        linkedFeatureId: pair.linkedFeatureId,
      },
    });
    if (result.count === 0) {
      throw new NotFoundException('Linked feature relationship not found.');
    }
    return this.listLinkedFeatures(userId, featureId);
  }

  async updateTestCase(userId: string, testCaseId: string, dto: UpdateTestCaseDto) {
    const testCase = await this.prisma.testCase.findUnique({
      where: { id: testCaseId },
      select: { featureId: true },
    });
    if (!testCase) {
      throw new NotFoundException('Test case not found.');
    }
    const projectId = await this.getProjectIdOrThrow(testCase.featureId);
    await assertProjectWrite(this.prisma, userId, projectId);

    const data: Prisma.TestCaseUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.steps !== undefined) data.steps = dto.steps;
    if (dto.expected !== undefined) data.expected = dto.expected;
    if (dto.isArchived !== undefined) data.isArchived = dto.isArchived;

    return this.prisma.testCase.update({
      where: { id: testCaseId },
      data,
    });
  }

  async createTestRun(
    userId: string,
    featureId: string,
    dto: CreateTestRunDto,
  ): Promise<TestRunDetail> {
    const projectId = await this.getProjectIdOrThrow(featureId);
    await assertProjectWrite(this.prisma, userId, projectId);

    const results = dto.results ?? [];
    this.ensureUniqueTestCaseIds(results);
    await this.validateTestCasesBelongToFeature(
      featureId,
      results.map((r) => r.testCaseId),
    );
    const requestedTargets = dto.targetTestCaseIds?.length ?? 0;
    this.logger.log(
      `createTestRun: received ${requestedTargets} explicit targetCaseIds for feature ${featureId}`,
    );
    const targetScope = await this.resolveTargetScope(projectId, featureId, dto.targetTestCaseIds);
    this.logger.log(
      `createTestRun: persisting ${
        targetScope.targetCaseIds.length
      } targetCaseIds (custom=${targetScope.isCustom}) for feature ${featureId}`,
    );

    const run = await this.prisma.testRun.create({
      data: {
        projectId,
        featureId,
        name: dto.name,
        environment: dto.environment,
        runById: dto.runById,
        notes: dto.notes,
        targetCaseIds: targetScope.targetCaseIds,
        isTargetScopeCustom: targetScope.isCustom,
        status: dto.status ?? TestRunStatus.OPEN,
      },
    });

    if (results.length > 0) {
      await this.prisma.testResult.createMany({
        data: results.map((result) => ({
          testRunId: run.id,
          testCaseId: result.testCaseId,
          evaluation: this.getEvaluationOrDefault(result.evaluation),
          comment: result.comment,
        })),
        skipDuplicates: true,
      });
    }

    return this.getTestRunDetail(run.id);
  }
  async createProjectTestRun(
    userId: string,
    projectId: string,
    dto: CreateProjectTestRunDto,
  ): Promise<TestRunDetail> {
    await assertProjectWrite(this.prisma, userId, projectId);

    const results = dto.results ?? [];
    if (results.length === 0) {
      throw new BadRequestException(
        'At least one test case result is required for a project-level run.',
      );
    }
    this.ensureUniqueTestCaseIds(results);
    await this.validateTestCasesBelongToProject(
      projectId,
      results.map((r) => r.testCaseId),
    );

    const requestedTargets = dto.targetTestCaseIds?.length ?? 0;
    this.logger.log(
      `createProjectTestRun: received ${requestedTargets} explicit targetCaseIds for project ${projectId}`,
    );
    const targetScope = await this.resolveTargetScope(projectId, null, dto.targetTestCaseIds);
    this.logger.log(
      `createProjectTestRun: persisting ${
        targetScope.targetCaseIds.length
      } targetCaseIds (custom=${targetScope.isCustom}) for project ${projectId}`,
    );

    const run = await this.prisma.testRun.create({
      data: {
        projectId,
        featureId: null,
        name: dto.name,
        environment: dto.environment,
        runById: dto.runById,
        notes: dto.notes,
        targetCaseIds: targetScope.targetCaseIds,
        isTargetScopeCustom: targetScope.isCustom,
        status: dto.status ?? TestRunStatus.OPEN
      },
    });

    await this.prisma.testResult.createMany({
      data: results.map((result) => ({
        testRunId: run.id,
        testCaseId: result.testCaseId,
        evaluation: this.getEvaluationOrDefault(result.evaluation),
        comment: result.comment,
      })),
      skipDuplicates: true,
    });

    return this.getTestRunDetail(run.id);
  }

  async updateTestRun(userId: string, runId: string, dto: UpdateTestRunDto): Promise<TestRunDetail> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      select: { id: true, projectId: true, featureId: true, targetCaseIds: true, isTargetScopeCustom: true },
    });
    if (!run) {
      throw new NotFoundException('Test run not found.');
    }

    await assertProjectWrite(this.prisma, userId, run.projectId);

    const runUpdateData: Prisma.TestRunUpdateInput = {};
    if (dto.name !== undefined) {
      runUpdateData.name = dto.name;
    }
    if (dto.environment !== undefined) {
      runUpdateData.environment = dto.environment;
    }
    if (dto.notes !== undefined) {
      runUpdateData.notes = dto.notes;
    }
    if (dto.status !== undefined) {
      runUpdateData.status = dto.status;
    }

    const addOrUpdateResults = dto.results ?? [];
    const removals = dto.removeTestCaseIds ?? [];
    const additions = dto.addTestCaseIds ?? [];

    const hasPayloadChanges =
      Object.keys(runUpdateData).length > 0 ||
      addOrUpdateResults.length > 0 ||
      removals.length > 0 ||
      additions.length > 0 ||
      dto.targetTestCaseIds !== undefined;

    if (!hasPayloadChanges) {
      throw new BadRequestException('Nothing to update.');
    }

    const hadCustomTargets = run.isTargetScopeCustom;
    let hasCustomTargets = hadCustomTargets;
    const currentTargets = this.buildTargetCaseSet(run.targetCaseIds);
    let targetsChanged = false;

    if (dto.targetTestCaseIds !== undefined) {
      const targetScopeOverride = await this.resolveTargetScope(
        run.projectId,
        run.featureId,
        dto.targetTestCaseIds,
      );
      currentTargets.clear();
      for (const id of targetScopeOverride.targetCaseIds) {
        currentTargets.add(id);
      }
      hasCustomTargets = targetScopeOverride.isCustom;
      targetsChanged = true;
      this.logger.log(
        `updateTestRun: run ${runId} explicit target scope set to ${currentTargets.size} cases (custom=${hasCustomTargets})`,
      );
    }

    if (additions.length > 0) {
      await this.assertCasesBelongToScope(run.projectId, run.featureId, additions);
      hasCustomTargets = true;
      for (const id of additions) {
        if (!currentTargets.has(id)) {
          currentTargets.add(id);
          targetsChanged = true;
        }
      }
    }

    if (addOrUpdateResults.length > 0) {
      this.ensureUniqueTestCaseIds(addOrUpdateResults);
      const testCaseIds = addOrUpdateResults.map((r) => r.testCaseId);
      await this.assertCasesBelongToScope(run.projectId, run.featureId, testCaseIds);

      if (hasCustomTargets) {
        for (const id of testCaseIds) {
          if (!currentTargets.has(id)) {
            currentTargets.add(id);
            targetsChanged = true;
          }
        }
      }

      await this.prisma.$transaction(
        addOrUpdateResults.map((result) => {
          const updateData: Prisma.TestResultUpdateInput = {
            comment: result.comment ?? null,
          };
          if (result.evaluation !== undefined) {
            updateData.evaluation = result.evaluation;
          }
          return this.prisma.testResult.upsert({
            where: {
              testRunId_testCaseId: {
                testRunId: runId,
                testCaseId: result.testCaseId,
              },
            },
            create: {
              testRunId: runId,
              testCaseId: result.testCaseId,
              evaluation: this.getEvaluationOrDefault(result.evaluation),
              comment: result.comment ?? null,
            },
            update: updateData,
          });
        }),
      );
    }

    if (removals.length > 0) {
      if (!hasCustomTargets) {
        const scopeCaseIds = await this.listScopeTestCaseIds(run.projectId, run.featureId);
        for (const id of scopeCaseIds) {
          currentTargets.add(id);
        }
        hasCustomTargets = true;
      }

      await this.prisma.testResult.deleteMany({
        where: {
          testRunId: runId,
          testCaseId: { in: removals },
        },
      });

      for (const id of removals) {
        if (currentTargets.delete(id)) {
          targetsChanged = true;
        }
      }
    }

    if (hasCustomTargets) {
      if (targetsChanged || !hadCustomTargets) {
        runUpdateData.targetCaseIds = Array.from(currentTargets);
      }
      if (!hadCustomTargets) {
        runUpdateData.isTargetScopeCustom = true;
      }
    } else if (hadCustomTargets) {
      runUpdateData.targetCaseIds = [];
      runUpdateData.isTargetScopeCustom = false;
    }

    if (Object.keys(runUpdateData).length > 0) {
      await this.prisma.testRun.update({
        where: { id: runId },
        data: runUpdateData,
      });
    }

    return this.getTestRunDetail(runId);
  }

  async upsertResults(
    userId: string,
    runId: string,
    dto: UpsertResultsDto,
  ): Promise<TestRunDetail> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      select: { id: true, featureId: true, projectId: true, targetCaseIds: true, isTargetScopeCustom: true },
    });
    if (!run) {
      throw new NotFoundException('Test run not found.');
    }

    await assertProjectWrite(this.prisma, userId, run.projectId);

    this.ensureUniqueTestCaseIds(dto.results);
    if (run.featureId) {
      await this.validateTestCasesBelongToFeature(
        run.featureId,
        dto.results.map((r) => r.testCaseId),
      );
    } else {
      await this.validateTestCasesBelongToProject(
        run.projectId,
        dto.results.map((r) => r.testCaseId),
      );
    }

    await this.prisma.$transaction(
      dto.results.map((result) => {
        const updateData: Prisma.TestResultUpdateInput = {
          comment: result.comment ?? null,
        };
        if (result.evaluation !== undefined) {
          updateData.evaluation = result.evaluation;
        }
        return this.prisma.testResult.upsert({
          where: {
            testRunId_testCaseId: {
              testRunId: runId,
              testCaseId: result.testCaseId,
            },
          },
          create: {
            testRunId: runId,
            testCaseId: result.testCaseId,
            evaluation: this.getEvaluationOrDefault(result.evaluation),
            comment: result.comment ?? null,
          },
          update: updateData,
        });
      }),
    );

    if (run.isTargetScopeCustom) {
      const currentTargets = this.buildTargetCaseSet(run.targetCaseIds);
      let targetsChanged = false;
      for (const id of dto.results.map((r) => r.testCaseId)) {
        if (!currentTargets.has(id)) {
          currentTargets.add(id);
          targetsChanged = true;
        }
      }
      if (targetsChanged) {
        await this.prisma.testRun.update({
          where: { id: runId },
          data: { targetCaseIds: Array.from(currentTargets) },
        });
      }
    }

    return this.getTestRunDetail(runId);
  }

  async getTestRun(userId: string, runId: string): Promise<TestRunDetail> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      select: { projectId: true },
    });
    if (!run) {
      throw new NotFoundException('Test run not found.');
    }

    await assertProjectRead(this.prisma, userId, run.projectId);

    return this.getTestRunDetail(runId);
  }

  async listTestRuns(userId: string, featureId: string, limit: number) {
    const projectId = await this.getProjectIdOrThrow(featureId);
    await assertProjectRead(this.prisma, userId, projectId);

    const runs = await this.prisma.testRun.findMany({
      where: { featureId },
      orderBy: { runDate: 'desc' },
      take: limit,
      include: {
        runBy: { select: { name: true } },
        results: { select: { evaluation: true } },
      },
    });

    return runs.map((run) => ({
      id: run.id,
      runDate: run.runDate,
      name: run.name,
      environment: run.environment,
      by: run.runBy?.name ?? null,
      status: run.status,
      summary: this.buildSummary(run.results.map((r) => r.evaluation)),
      totalTestCases : run.targetCaseIds.length > 0 ? run.targetCaseIds.length : 0,
    }));
  }

  async listProjectTestRuns(
    userId: string,
    projectId: string,
    limit: number,
    scope: 'ALL' | 'PROJECT' | 'FEATURE' = 'ALL',
  ) {
    await assertProjectRead(this.prisma, userId, projectId);

    const scopeFilter =
      scope === 'PROJECT'
        ? { featureId: null }
        : scope === 'FEATURE'
          ? { featureId: { not: null } }
          : {};

    const runs = await this.prisma.testRun.findMany({
      where: { projectId, ...scopeFilter },
      orderBy: { runDate: 'desc' },
      take: limit,
      include: {
        runBy: { select: { name: true } },
        feature: { select: { id: true, name: true } },
        results: { select: { evaluation: true } },
      },
    });

    return runs.map((run) => ({
      id: run.id,
      runDate: run.runDate,
      name: run.name,
      environment: run.environment,
      by: run.runBy?.name ?? null,
      feature: run.feature ? { id: run.feature.id, name: run.feature.name } : null,
      status: run.status,
      summary: this.buildSummary(run.results.map((r) => r.evaluation)),
    }));
  }

  async getProjectDashboard(userId: string, projectId: string) {
    await assertProjectRead(this.prisma, userId, projectId);
    const data = await this.buildProjectDashboardData(projectId);
    const { featuresWithoutTestCases } = data.metrics;
    return {
      projectId,
      metrics: data.metrics,
      featuresWithoutTestCases,
    };
  }

  private async buildProjectDashboardData(projectId: string): Promise<ProjectDashboardData> {
    const features = await this.prisma.feature.findMany({
      where: { module: { projectId } },
      select: { id: true, name: true, description: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
    const modules = await this.prisma.module.findMany({
      where: { projectId },
      select: { id: true, name: true, description: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
    const totalFeatures = features.length;
    const isMissingDescription = (text?: string | null) => !text || text.trim().length === 0;
    const missingFeatureDescriptions = features
      .filter((feature) => isMissingDescription(feature.description))
      .map((feature) => ({
        id: feature.id,
        name: feature.name,
        createdAt: feature.createdAt,
        entityType: 'FEATURE' as const,
      }));
    const missingModuleDescriptions = modules
      .filter((module) => isMissingDescription(module.description))
      .map((module) => ({
        id: module.id,
        name: module.name,
        createdAt: module.createdAt,
        entityType: 'MODULE' as const,
      }));
    const featuresMissingDescription: MissingDescriptionItem[] = [
      ...missingFeatureDescriptions,
      ...missingModuleDescriptions,
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(({ createdAt, ...item }) => item);
    const featureTestCaseCountsRaw = await this.prisma.testCase.groupBy({
      by: ['featureId'],
      where: {
        isArchived: false,
        feature: {
          module: { projectId },
        },
      },
      _count: {
        _all: true,
      },
    });
    const featureTestCaseCounts = new Map(
      featureTestCaseCountsRaw.map((row) => [row.featureId, row._count._all]),
    );
    const featuresWithoutTestCases = features
      .filter((feature) => (featureTestCaseCounts.get(feature.id) ?? 0) === 0)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((feature) => ({ id: feature.id, name: feature.name }));

    const latestRunPairs = await this.prisma.$queryRaw<
      { featureId: string; id: string }[]
    >`SELECT DISTINCT ON ("featureId") "id", "featureId"
      FROM "TestRun"
      WHERE "projectId" = ${projectId} AND "featureId" IS NOT NULL
      ORDER BY "featureId", "runDate" DESC`;
    const latestRunIds = latestRunPairs.map((pair) => pair.id);

    const latestRuns = latestRunIds.length
      ? await this.prisma.testRun.findMany({
          where: { id: { in: latestRunIds } },
          include: testRunDetailInclude,
        })
      : [];

    const latestRunDetails = await Promise.all(
      latestRuns.map(async (run) => {
        const coverage = await this.buildCoverage(run);
        return {
          run,
          coverage,
          passRate: this.calculatePassRate(run, coverage),
        };
      }),
    );

    const featureRunInfo = new Map<
      string,
      { run: TestRunRecord; coverage: RunCoverage; passRate: number | null }
    >();
    for (const detail of latestRunDetails) {
      if (!detail.run.featureId) {
        continue;
      }
      featureRunInfo.set(detail.run.featureId, detail);
    }

    const featureCoverage = features
      .map((feature) => {
        const info = featureRunInfo.get(feature.id);
        if (!info) {
          return null;
        }
        const totalTestCases = featureTestCaseCounts.get(feature.id) ?? 0;
        const executedTestCases = new Set(info.run.results.map((result) => result.testCaseId)).size;
        const missingTestCases = Math.max(totalTestCases - executedTestCases, 0);
        const coverageRatio = totalTestCases > 0 ? executedTestCases / totalTestCases : null;
        return {
          featureId: feature.id,
          featureName: feature.name,
          totalTestCases,
          executedTestCases,
          missingTestCases,
          coverageRatio,
          latestRun: {
            id: info.run.id,
            runDate: info.run.runDate,
            status: info.run.status,
          },
        };
      })
      .filter((feature): feature is NonNullable<typeof feature> => Boolean(feature));

    const featureHealth = features
      .map((feature) => {
        const info = featureRunInfo.get(feature.id);
        if (!info) {
          return null;
        }
        const testCaseCount = featureTestCaseCounts.get(feature.id) ?? 0;
        const executedEvaluations = new Map<string, TestEvaluation>();
        for (const result of info.run.results) {
          executedEvaluations.set(result.testCaseId, result.evaluation);
        }
        let passedTestCases = 0;
        let failedTestCases = 0;
        for (const evaluation of executedEvaluations.values()) {
          if (evaluation === TestEvaluation.PASSED) {
            passedTestCases += 1;
          } else if (evaluation !== TestEvaluation.NOT_STARTED) {
            failedTestCases += 1;
          }
        }
        const executedTestCases = executedEvaluations.size;
        const missingTestCasesCount = Math.max(testCaseCount - executedTestCases, 0);
        return {
          featureId: feature.id,
          featureName: feature.name,
          passRate: info?.passRate ?? null,
          executedTestCases,
          passedTestCases,
          failedTestCases,
          hasMissingTestCases: missingTestCasesCount > 0,
          missingTestCasesCount,
          latestRun: {
            id: info.run.id,
            runDate: info.run.runDate,
            status: info.run.status,
          },
        };
      })
      .filter((feature): feature is NonNullable<typeof feature> => Boolean(feature));

    const openRunsRaw = await this.prisma.testRun.findMany({
      where: { projectId, status: TestRunStatus.OPEN },
      orderBy: { runDate: 'desc' },
      include: {
        feature: { select: { id: true, name: true } },
        runBy: { select: { id: true, name: true } },
      },
    });
    const openRuns = openRunsRaw.map((run) => ({
      id: run.id,
      runDate: run.runDate,
      environment: run.environment,
      status: run.status,
      feature: run.feature ? { id: run.feature.id, name: run.feature.name } : null,
      runBy: run.runBy?.name ?? null,
    }));

    const runsWithFullPass = latestRunDetails
      .filter(
        ({ coverage }) =>
          coverage.totalCases > 0 && coverage.executedCases === coverage.totalCases && coverage.missingCases === 0,
      )
      .filter(({ run }) => run.results.every((result) => result.evaluation === TestEvaluation.PASSED))
      .map(({ run, coverage }) => ({
        id: run.id,
        runDate: run.runDate,
        feature: run.feature ? { id: run.feature.id, name: run.feature.name } : null,
        coverage,
      }));

    const featuresWithRuns = featureRunInfo.size;
    const testCoverageRatio = totalFeatures > 0 ? featuresWithRuns / totalFeatures : null;

    return {
      metrics: {
        totalFeatures,
        featuresMissingDescription: featuresMissingDescription.length,
        featuresWithoutTestCases: featuresWithoutTestCases.length,
        featuresWithRuns,
        testCoverageRatio,
        openRuns: openRuns.length,
        runsWithFullPass: runsWithFullPass.length,
      },
      reports: {
        featuresMissingDescription,
        featuresWithoutTestCases,
        featureCoverage,
        featureHealth,
        openRuns,
        runsWithFullPass,
      },
    };
  }

  async getProjectDashboardFeaturesMissingDescription(
    userId: string,
    projectId: string,
    options: ListQueryOptions,
  ): Promise<PaginatedResult<MissingDescriptionItem>> {
    await assertProjectRead(this.prisma, userId, projectId);
    const data = await this.buildProjectDashboardData(projectId);
    const requestedType = options.filters?.type?.toUpperCase();
    const filterType = requestedType === 'FEATURE' || requestedType === 'MODULE' ? requestedType : null;
    const items = filterType
      ? data.reports.featuresMissingDescription.filter((item) => item.entityType === filterType)
      : data.reports.featuresMissingDescription;
    return this.paginateArray(items, options.pagination);
  }

  async getProjectDashboardFeaturesWithoutTestCases(
    userId: string,
    projectId: string,
    options: ListQueryOptions,
  ): Promise<PaginatedResult<{ id: string; name: string }>> {
    await assertProjectRead(this.prisma, userId, projectId);
    const data = await this.buildProjectDashboardData(projectId);
    return this.paginateArray(data.reports.featuresWithoutTestCases, options.pagination);
  }

  async getProjectDashboardFeatureCoverage(
    userId: string,
    projectId: string,
    options: ListQueryOptions,
  ): Promise<
    PaginatedResult<{
      featureId: string;
      featureName: string;
      totalTestCases: number;
      executedTestCases: number;
      missingTestCases: number;
      coverageRatio: number | null;
      latestRun: {
        id: string;
        runDate: Date;
        status: TestRunStatus;
      } | null;
    }>
  > {
    await assertProjectRead(this.prisma, userId, projectId);
    const data = await this.buildProjectDashboardData(projectId);
    const query = options.filters?.query?.trim().toLowerCase() ?? null;
    const filtered = query
      ? data.reports.featureCoverage.filter((feature) => {
          const featureName = feature.featureName.toLowerCase();
          return featureName.includes(query) || feature.featureId.toLowerCase().includes(query);
        })
      : data.reports.featureCoverage;
    const sorted = this.sortFeatureCoverage(filtered, options.sort);
    return this.paginateArray(sorted, options.pagination);
  }

  async getProjectDashboardFeatureHealth(
    userId: string,
    projectId: string,
    options: ListQueryOptions,
  ): Promise<
    PaginatedResult<{
      featureId: string;
      featureName: string;
      passRate: number | null;
      executedTestCases: number;
      passedTestCases: number;
      failedTestCases: number;
      hasMissingTestCases: boolean;
      missingTestCasesCount: number;
      latestRun: {
        id: string;
        runDate: Date;
        status: TestRunStatus;
      } | null;
    }>
  > {
    await assertProjectRead(this.prisma, userId, projectId);
    const data = await this.buildProjectDashboardData(projectId);
    const sorted = this.sortByLatestRunDateDescending(
      data.reports.featureHealth,
      (feature) => feature.latestRun?.runDate ?? null,
    );
    return this.paginateArray(sorted, options.pagination);
  }

  async getProjectDashboardOpenRuns(
    userId: string,
    projectId: string,
    options: ListQueryOptions,
  ): Promise<
    PaginatedResult<{
      id: string;
      runDate: Date;
      environment: string | null;
      status: TestRunStatus;
      feature: { id: string; name: string } | null;
      runBy: string | null;
    }>
  > {
    await assertProjectRead(this.prisma, userId, projectId);
    const data = await this.buildProjectDashboardData(projectId);
    return this.paginateArray(data.reports.openRuns, options.pagination);
  }

  async getProjectDashboardRunsWithFullPass(
    userId: string,
    projectId: string,
    options: ListQueryOptions,
  ): Promise<
    PaginatedResult<{
      id: string;
      runDate: Date;
      feature: { id: string; name: string } | null;
      coverage: RunCoverage;
    }>
  > {
    await assertProjectRead(this.prisma, userId, projectId);
    const data = await this.buildProjectDashboardData(projectId);
    const sorted = this.sortByLatestRunDateDescending(
      data.reports.runsWithFullPass,
      (run) => run.runDate,
    );
    return this.paginateArray(sorted, options.pagination);
  }

  async getTestHealth(userId: string, featureId: string) {
    const projectId = await this.getProjectIdOrThrow(featureId);
    await assertProjectRead(this.prisma, userId, projectId);

    const totalTestCases = await this.prisma.testCase.count({
      where: { featureId, isArchived: false },
    });

    const latestRun = await this.prisma.testRun.findFirst({
      where: { featureId },
      orderBy: { runDate: 'desc' },
      include: testRunDetailInclude,
    });

    if (!latestRun) {
      return {
        featureId,
        lastRun: null,
        passRate: null,
        allTestCasesCovered: totalTestCases === 0,
        testCaseCounts: {
          total: totalTestCases,
          executed: 0,
        },
      };
    }

    const coverage = await this.buildCoverage(latestRun);
    const passRate = this.calculatePassRate(latestRun, coverage);
    const executedTestCases = new Set(latestRun.results.map((result) => result.testCaseId)).size;
    const allTestCasesCovered = totalTestCases === 0 ? true : executedTestCases >= totalTestCases;

    return {
      featureId,
      lastRun: { id: latestRun.id, runDate: latestRun.runDate },
      passRate,
      allTestCasesCovered,
      testCaseCounts: {
        total: totalTestCases,
        executed: executedTestCases,
      },
    };
  }

  private getEvaluationOrDefault(evaluation?: TestEvaluation): TestEvaluation {
    return evaluation ?? TestEvaluation.NOT_STARTED;
  }

  private normalizeFeatureLinkPair(
    featureId: string,
    otherFeatureId: string,
  ): { featureId: string; linkedFeatureId: string } {
    return featureId < otherFeatureId
      ? { featureId, linkedFeatureId: otherFeatureId }
      : { featureId: otherFeatureId, linkedFeatureId: featureId };
  }

  private buildSummary(evaluations: TestEvaluation[]): Record<TestEvaluation, number> {
    const summary: Record<TestEvaluation, number> = {
      [TestEvaluation.NOT_STARTED]: 0,
      [TestEvaluation.NOT_WORKING]: 0,
      [TestEvaluation.MINOR_ISSUE]: 0,
      [TestEvaluation.PASSED]: 0,
    };

    for (const evaluation of evaluations) {
      summary[evaluation] += 1;
    }
    return summary;
  }

  private ensureUniqueTestCaseIds(results: TestResultInput[]): void {
    const seen = new Set<string>();
    for (const result of results) {
      if (seen.has(result.testCaseId)) {
        throw new BadRequestException('Duplicate testCaseId detected in results payload.');
      }
      seen.add(result.testCaseId);
    }
  }

  private async validateTestCasesBelongToFeature(
    featureId: string,
    testCaseIds: string[],
  ): Promise<void> {
    if (testCaseIds.length === 0) {
      return;
    }

    const uniqueIds = Array.from(new Set(testCaseIds));
    const count = await this.prisma.testCase.count({
      where: {
        featureId,
        id: { in: uniqueIds },
      },
    });
    if (count !== uniqueIds.length) {
      throw new BadRequestException('One or more test cases do not belong to the feature.');
    }
  }

  private async validateTestCasesBelongToProject(
    projectId: string,
    testCaseIds: string[],
  ): Promise<void> {
    if (testCaseIds.length === 0) {
      return;
    }

    const uniqueIds = Array.from(new Set(testCaseIds));
    const count = await this.prisma.testCase.count({
      where: {
        id: { in: uniqueIds },
        feature: {
          module: {
            projectId,
          },
        },
      },
    });
    if (count !== uniqueIds.length) {
      throw new BadRequestException('One or more test cases do not belong to the project.');
    }
  }

  private async resolveTargetScope(
    projectId: string,
    featureId: string | null,
    explicitIds?: string[],
  ): Promise<{ targetCaseIds: string[]; isCustom: boolean }> {
    const uniqueExplicit = explicitIds?.length ? Array.from(new Set(explicitIds)) : null;
    if (uniqueExplicit?.length) {
      await this.assertCasesBelongToScope(projectId, featureId, uniqueExplicit);
      return { targetCaseIds: uniqueExplicit, isCustom: true };
    }
    return { targetCaseIds: [], isCustom: false };
  }

  private buildTargetCaseSet(targetCaseIds: string[] | null | undefined): Set<string> {
    return new Set(targetCaseIds ?? []);
  }

  private async assertCasesBelongToScope(
    projectId: string,
    featureId: string | null,
    testCaseIds: string[],
  ): Promise<void> {
    if (testCaseIds.length === 0) {
      return;
    }
    if (featureId) {
      await this.validateTestCasesBelongToFeature(featureId, testCaseIds);
    } else {
      await this.validateTestCasesBelongToProject(projectId, testCaseIds);
    }
  }

  private async listScopeTestCaseIds(projectId: string, featureId: string | null): Promise<string[]> {
    if (featureId) {
      const cases = await this.prisma.testCase.findMany({
        where: { featureId, isArchived: false },
        select: { id: true },
      });
      return cases.map((testCase) => testCase.id);
    }

    const projectCases = await this.prisma.testCase.findMany({
      where: {
        feature: {
          module: {
            projectId,
          },
        },
        isArchived: false,
      },
      select: { id: true },
    });
    return projectCases.map((testCase) => testCase.id);
  }

  private async getProjectIdOrThrow(featureId: string): Promise<string> {
    const projectId = await this.getProjectIdByFeature(featureId);
    if (!projectId) {
      throw new NotFoundException('Feature not found.');
    }
    return projectId;
  }

  private async getProjectIdByModule(moduleId: string): Promise<string | null> {
    const module = await this.prisma.module.findUnique({
      where: { id: moduleId },
      select: { projectId: true },
    });
    return module?.projectId ?? null;
  }

  private async getProjectIdByModuleOrThrow(moduleId: string): Promise<string> {
    const projectId = await this.getProjectIdByModule(moduleId);
    if (!projectId) {
      throw new NotFoundException('Module not found.');
    }
    return projectId;
  }

  private async getTestRunDetail(runId: string): Promise<TestRunDetail> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      include: testRunDetailInclude,
    });
    if (!run) {
      throw new NotFoundException('Test run not found.');
    }
    const coverage = await this.buildCoverage(run);
    return {
      ...run,
      coverage,
    };
  }

  private calculatePassRate(run: TestRunRecord, coverage: RunCoverage): number | null {
    const passed = run.results.filter((result) => result.evaluation === TestEvaluation.PASSED).length;
    const denominator = coverage.totalCases > 0 ? coverage.totalCases : run.results.length;
    if (denominator === 0) {
      return null;
    }
    return passed / denominator;
  }

  private async buildCoverage(run: TestRunRecord): Promise<RunCoverage> {
    const executedIds = new Set(run.results.map((result) => result.testCaseId));
    const targetIds =
      run.targetCaseIds.length > 0
        ? Array.from(new Set(run.targetCaseIds))
        : Array.from(executedIds);

    const scope = run.featureId ? 'FEATURE' : 'PROJECT';
    const missingIds = targetIds.filter((id) => !executedIds.has(id));
    const executedCount = targetIds.length - missingIds.length;

    const detailMap = new Map<
      string,
      { id: string; name: string; featureId: string; featureName: string }
    >();

    if (targetIds.length > 0) {
      const caseDetails = await this.prisma.testCase.findMany({
        where: { id: { in: targetIds } },
        select: {
          id: true,
          name: true,
          featureId: true,
          feature: { select: { id: true, name: true } },
        },
      });
      for (const testCase of caseDetails) {
        detailMap.set(testCase.id, {
          id: testCase.id,
          name: testCase.name,
          featureId: testCase.featureId,
          featureName: testCase.feature?.name ?? 'Unknown feature',
        });
      }
    }

    const missingTestCases = missingIds.map((id) => {
      const fallbackFeatureName = run.feature?.name ?? 'Unknown feature';
      const fallbackFeatureId = run.featureId ?? 'unknown';
      const detail = detailMap.get(id);
      return {
        id,
        name: detail?.name ?? 'Unknown test case',
        featureId: detail?.featureId ?? fallbackFeatureId,
        featureName: detail?.featureName ?? fallbackFeatureName,
      };
    });

    return {
      scope,
      totalCases: targetIds.length,
      executedCases: executedCount,
      missingCases: missingIds.length,
      missingTestCases,
    };
  }

  private sortFeatureCoverage(
    items: Array<{
      featureId: string;
      featureName: string;
      totalTestCases: number;
      executedTestCases: number;
      missingTestCases: number;
      coverageRatio: number | null;
      latestRun: {
        id: string;
        runDate: Date;
        status: TestRunStatus;
      } | null;
    }>,
    sort?: string,
  ) {
    if (!sort) {
      return this.sortByLatestRunDateDescending(items, (item) => item.latestRun?.runDate ?? null);
    }
    if (sort !== 'coverageAsc' && sort !== 'coverageDesc') {
      throw new BadRequestException('Invalid sort parameter. Use coverageAsc or coverageDesc.');
    }
    const direction = sort === 'coverageAsc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const ratioA = a.coverageRatio ?? 0;
      const ratioB = b.coverageRatio ?? 0;
      if (ratioA === ratioB) {
        const dateA = a.latestRun?.runDate ?? null;
        const dateB = b.latestRun?.runDate ?? null;
        if (dateA && dateB) {
          const diff = dateB.getTime() - dateA.getTime();
          if (diff !== 0) {
            return diff;
          }
          return a.featureName.localeCompare(b.featureName);
        }
        if (dateA) {
          return -1;
        }
        if (dateB) {
          return 1;
        }
        return a.featureName.localeCompare(b.featureName);
      }
      return ratioA > ratioB ? direction : -direction;
    });
  }

  private paginateArray<T>(items: T[], pagination: PaginationInput): PaginatedResult<T> {
    const page = Math.max(1, Math.floor(pagination.page));
    const pageSize = Math.max(1, Math.floor(pagination.pageSize));
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return {
      items: items.slice(startIndex, endIndex),
      total: items.length,
      page,
      pageSize,
    };
  }

  private sortByLatestRunDateDescending<T>(
    items: T[],
    getRunDate: (item: T) => Date | null | undefined,
  ): T[] {
    return [...items].sort((a, b) => {
      const dateA = getRunDate(a);
      const dateB = getRunDate(b);
      if (dateA && dateB) {
        return dateB.getTime() - dateA.getTime();
      }
      if (dateA) {
        return -1;
      }
      if (dateB) {
        return 1;
      }
      return 0;
    });
  }

  private async getProjectMemberRole(userId: string, projectId: string): Promise<ProjectMemberRole | null> {
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  private async assertProjectOwner(userId: string, projectId: string): Promise<void> {
    const role = await this.getProjectMemberRole(userId, projectId);
    if (role !== ProjectMemberRole.OWNER) {
      throw new ForbiddenException('Only the project owner can manage labels.');
    }
  }

  private mapProjectLabel(label: {
    id: string;
    name: string;
    isMandatory: boolean;
    defaultNotApplicable: boolean;
    visibleToRoles: ProjectMemberRole[];
    readOnlyRoles: ProjectMemberRole[];
    displayOrder: number;
  }): ProjectLabelView {
    return {
      id: label.id,
      name: label.name,
      isMandatory: label.isMandatory,
      defaultNotApplicable: label.defaultNotApplicable ?? false,
      visibleToRoles: label.visibleToRoles ?? [],
      readOnlyRoles: label.readOnlyRoles ?? [],
      displayOrder: label.displayOrder ?? 0,
    };
  }

  private canViewLabel(role: ProjectMemberRole, label: ProjectLabelView): boolean {
    if (role === ProjectMemberRole.OWNER) {
      return true;
    }
    if (!label.visibleToRoles || label.visibleToRoles.length === 0) {
      return true;
    }
    return label.visibleToRoles.includes(role);
  }

  private canEditLabel(role: ProjectMemberRole, label: ProjectLabelView): boolean {
    if (!this.canViewLabel(role, label)) {
      return false;
    }
    if (!QaService.WRITE_ROLES.has(role)) {
      return false;
    }
    if (role === ProjectMemberRole.OWNER) {
      return true;
    }
    return !label.readOnlyRoles.includes(role);
  }

  private async listDocumentationEntries(params: {
    userId: string;
    projectId: string;
    entityType: DocumentationEntityType;
    entityId: string;
  }): Promise<DocumentationEntry[]> {
    const { userId, projectId, entityType, entityId } = params;
    const role = await this.getProjectMemberRoleOrThrow(userId, projectId);
    const labels = await this.prisma.projectLabel.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    const labelViews = labels.map((label) => this.mapProjectLabel(label));
    const records = await this.prisma.documentationField.findMany({
      where: {
        projectId,
        entityType,
        featureId: entityType === DocumentationEntityType.FEATURE ? entityId : undefined,
        moduleId: entityType === DocumentationEntityType.MODULE ? entityId : undefined,
      },
      orderBy: { createdAt: 'asc' },
    });
    const recordMap = new Map(records.map((record) => [record.labelId, record]));

    return labelViews
      .filter((label) => this.canViewLabel(role, label))
      .map((label) => {
        const record = recordMap.get(label.id);
        return {
          label,
          field: record
            ? {
                id: record.id,
                content: record.content ?? null,
                isNotApplicable: record.isNotApplicable,
                updatedAt: record.updatedAt,
              }
            : null,
          canEdit: this.canEditLabel(role, label),
        };
      });
  }

  private async createDefaultDocumentationForLabel(projectId: string, labelId: string): Promise<void> {
    const [modules, features] = await this.prisma.$transaction([
      this.prisma.module.findMany({
        where: { projectId },
        select: { id: true },
      }),
      this.prisma.feature.findMany({
        where: { module: { projectId } },
        select: { id: true },
      }),
    ]);

    const moduleDocs = modules.map((mod) => ({
      projectId,
      entityType: DocumentationEntityType.MODULE,
      moduleId: mod.id,
      labelId,
      isNotApplicable: true,
    }));

    const featureDocs = features.map((feature) => ({
      projectId,
      entityType: DocumentationEntityType.FEATURE,
      featureId: feature.id,
      labelId,
      isNotApplicable: true,
    }));

    const writes: Prisma.PrismaPromise<unknown>[] = [];
    if (moduleDocs.length > 0) {
      writes.push(
        this.prisma.documentationField.createMany({
          data: moduleDocs,
          skipDuplicates: true,
        }),
      );
    }
    if (featureDocs.length > 0) {
      writes.push(
        this.prisma.documentationField.createMany({
          data: featureDocs,
          skipDuplicates: true,
        }),
      );
    }

    if (writes.length > 0) {
      await this.prisma.$transaction(writes);
    }
  }

  private async upsertDocumentationField(params: {
    userId: string;
    projectId: string;
    entityType: DocumentationEntityType;
    entityId: string;
    labelId: string;
    dto: { content?: string; isNotApplicable?: boolean };
  }): Promise<void> {
    const { userId, projectId, entityType, entityId, labelId, dto } = params;
    const role = await this.getProjectMemberRoleOrThrow(userId, projectId);
    const label = await this.prisma.projectLabel.findUnique({
      where: { id: labelId },
    });
    if (!label || label.projectId !== projectId) {
      throw new BadRequestException('Label not found for this project.');
    }
    const labelView = this.mapProjectLabel(label);
    if (!this.canViewLabel(role, labelView)) {
      throw new ForbiddenException('You cannot use this label.');
    }
    if (!this.canEditLabel(role, labelView)) {
      throw new ForbiddenException('You do not have permission to edit this label.');
    }

    const existing = await this.prisma.documentationField.findFirst({
      where: {
        projectId,
        entityType,
        labelId,
        featureId: entityType === DocumentationEntityType.FEATURE ? entityId : null,
        moduleId: entityType === DocumentationEntityType.MODULE ? entityId : null,
      },
    });

    if (existing) {
      const data: Prisma.DocumentationFieldUpdateInput = {};
      if (dto.content !== undefined) {
        data.content = dto.content;
      }
      if (dto.isNotApplicable !== undefined) {
        data.isNotApplicable = dto.isNotApplicable;
      }
      if (Object.keys(data).length === 0) {
        throw new BadRequestException('Nothing to update.');
      }
      await this.prisma.documentationField.update({
        where: { id: existing.id },
        data,
      });
      return;
    }

    if (dto.content === undefined && dto.isNotApplicable === undefined) {
      throw new BadRequestException('Provide content or mark the label as not applicable.');
    }

    await this.prisma.documentationField.create({
      data: {
        projectId,
        entityType,
        featureId: entityType === DocumentationEntityType.FEATURE ? entityId : null,
        moduleId: entityType === DocumentationEntityType.MODULE ? entityId : null,
        labelId,
        content: dto.content ?? null,
        isNotApplicable: dto.isNotApplicable ?? false,
      },
    });
  }

  private async getProjectMemberRoleOrThrow(userId: string, projectId: string): Promise<ProjectMemberRole> {
    const role = await this.getProjectMemberRole(userId, projectId);
    if (!role) {
      throw new ForbiddenException('Access denied for project.');
    }
    return role;
  }
}
