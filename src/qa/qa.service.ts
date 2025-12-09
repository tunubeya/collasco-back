import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TestEvaluation, TestRunStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTestCasesDto } from './dto/create-test-cases.dto';
import { UpdateTestCaseDto } from './dto/update-test-case.dto';
import { CreateTestRunDto, TestResultInput } from './dto/create-test-run.dto';
import { UpsertResultsDto } from './dto/upsert-results.dto';
import { assertProjectRead, assertProjectWrite } from './guards/rbac.helpers';
import { CreateProjectTestRunDto } from './dto/create-project-test-run.dto';
import { UpdateTestRunDto } from './dto/update-test-run.dto';

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

@Injectable()
export class QaService {
  private readonly logger = new Logger(QaService.name);
  private static readonly EVALUATIONS: TestEvaluation[] = [
    TestEvaluation.NOT_WORKING,
    TestEvaluation.MINOR_ISSUE,
    TestEvaluation.PASSED,
  ];

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
          evaluation: result.evaluation,
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
        evaluation: result.evaluation,
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
        addOrUpdateResults.map((result) =>
          this.prisma.testResult.upsert({
            where: {
              testRunId_testCaseId: {
                testRunId: runId,
                testCaseId: result.testCaseId,
              },
            },
            create: {
              testRunId: runId,
              testCaseId: result.testCaseId,
              evaluation: result.evaluation,
              comment: result.comment ?? null,
            },
            update: {
              evaluation: result.evaluation,
              comment: result.comment ?? null,
            },
          }),
        ),
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
      dto.results.map((result) =>
        this.prisma.testResult.upsert({
          where: {
            testRunId_testCaseId: {
              testRunId: runId,
              testCaseId: result.testCaseId,
            },
          },
          create: {
            testRunId: runId,
            testCaseId: result.testCaseId,
            evaluation: result.evaluation,
            comment: result.comment ?? null,
          },
          update: {
            evaluation: result.evaluation,
            comment: result.comment ?? null,
          },
        }),
      ),
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

    const features = await this.prisma.feature.findMany({
      where: { module: { projectId } },
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
    const totalFeatures = features.length;
    const featuresMissingDescription = features
      .filter((feature) => !feature.description || feature.description.trim().length === 0)
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

    const featureCoverage = features.map((feature) => {
      const info = featureRunInfo.get(feature.id);
      return {
        featureId: feature.id,
        featureName: feature.name,
        hasDescription: Boolean(feature.description && feature.description.trim().length > 0),
        hasTestRun: Boolean(info),
        latestRun: info
          ? {
              id: info.run.id,
              runDate: info.run.runDate,
              status: info.run.status,
              coverage: info.coverage,
            }
          : null,
      };
    });

    const featureHealth = features.map((feature) => {
      const info = featureRunInfo.get(feature.id);
      return {
        featureId: feature.id,
        featureName: feature.name,
        passRate: info?.passRate ?? null,
        latestRun: info
          ? {
              id: info.run.id,
              runDate: info.run.runDate,
              status: info.run.status,
            }
          : null,
      };
    });
    const passRates = featureHealth
      .map((feature) => feature.passRate)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const averagePassRate =
      passRates.length > 0 ? passRates.reduce((sum, rate) => sum + rate, 0) / passRates.length : null;

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
      projectId,
      metrics: {
        totalFeatures,
        featuresMissingDescription: featuresMissingDescription.length,
        featuresWithRuns,
        testCoverageRatio,
        openRuns: openRuns.length,
        runsWithFullPass: runsWithFullPass.length,
        averagePassRate,
      },
      reports: {
        featuresMissingDescription,
        featureCoverage,
        featureHealth,
        openRuns,
        runsWithFullPass,
      },
    };
  }

  async getTestHealth(userId: string, featureId: string) {
    const projectId = await this.getProjectIdOrThrow(featureId);
    await assertProjectRead(this.prisma, userId, projectId);

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
      };
    }

    const coverage = await this.buildCoverage(latestRun);
    const passRate = this.calculatePassRate(latestRun, coverage);

    return {
      featureId,
      lastRun: { id: latestRun.id, runDate: latestRun.runDate },
      passRate,
    };
  }

  private buildSummary(evaluations: TestEvaluation[]): Record<TestEvaluation, number> {
    const summary: Record<TestEvaluation, number> = {
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
    if (run.isTargetScopeCustom) {
      const scope = run.featureId ? 'FEATURE' : 'PROJECT';
      const targetCases = run.targetCaseIds.length
        ? await this.prisma.testCase.findMany({
            where: { id: { in: run.targetCaseIds } },
            select: {
              id: true,
              name: true,
              featureId: true,
              feature: { select: { id: true, name: true } },
            },
          })
        : [];
      const scopeCases = await this.listScopeCasesForRun(run);
      const orderMap = new Map(targetCases.map((testCase) => [testCase.id, testCase]));
      const orderedTargetCases = run.targetCaseIds
        .map((id) => orderMap.get(id))
        .filter((testCase): testCase is (typeof targetCases)[number] => Boolean(testCase));
      const targetSet = new Set(run.targetCaseIds);
      const additionalCases = scopeCases.filter((testCase) => !targetSet.has(testCase.id));
      const orderedCases = [...orderedTargetCases, ...additionalCases];
      const missingCases = orderedCases.filter((testCase) => !executedIds.has(testCase.id));
      return {
        scope,
        totalCases: orderedCases.length,
        executedCases: orderedCases.length - missingCases.length,
        missingCases: missingCases.length,
        missingTestCases: missingCases.map((testCase) => ({
          id: testCase.id,
          name: testCase.name,
          featureId: testCase.featureId,
          featureName: testCase.feature?.name ?? run.feature?.name ?? 'Unknown feature',
        })),
      };
    }

    if (run.featureId) {
      const cases = await this.prisma.testCase.findMany({
        where: { featureId: run.featureId, isArchived: false },
        select: {
          id: true,
          name: true,
          featureId: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      const missing = cases.filter((testCase) => !executedIds.has(testCase.id));
      const featureName = run.feature?.name ?? 'Unknown feature';
      return {
        scope: 'FEATURE',
        totalCases: cases.length,
        executedCases: cases.length - missing.length,
        missingCases: missing.length,
        missingTestCases: missing.map((testCase) => ({
          id: testCase.id,
          name: testCase.name,
          featureId: testCase.featureId,
          featureName,
        })),
      };
    }

    const projectCases = await this.prisma.testCase.findMany({
      where: {
        feature: {
          module: {
            projectId: run.project.id,
          },
        },
        isArchived: false,
      },
      select: {
        id: true,
        name: true,
        featureId: true,
        feature: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const missingProjectCases = projectCases.filter((testCase) => !executedIds.has(testCase.id));
    return {
      scope: 'PROJECT',
      totalCases: projectCases.length,
      executedCases: projectCases.length - missingProjectCases.length,
      missingCases: missingProjectCases.length,
      missingTestCases: missingProjectCases.map((testCase) => ({
        id: testCase.id,
        name: testCase.name,
        featureId: testCase.featureId,
        featureName: testCase.feature?.name ?? 'Unknown feature',
      })),
    };
  }

  private async listScopeCasesForRun(
    run: TestRunRecord,
  ): Promise<
    Array<{
      id: string;
      name: string;
      featureId: string;
      feature: { id: string; name: string } | null;
    }>
  > {
    if (run.featureId) {
      return this.prisma.testCase.findMany({
        where: { featureId: run.featureId, isArchived: false },
        select: {
          id: true,
          name: true,
          featureId: true,
          feature: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    return this.prisma.testCase.findMany({
      where: {
        feature: {
          module: {
            projectId: run.project.id,
          },
        },
        isArchived: false,
      },
      select: {
        id: true,
        name: true,
        featureId: true,
        feature: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
