import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
    const targetScope = await this.resolveTargetScope(projectId, featureId, dto.targetTestCaseIds);

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

    const targetScope = await this.resolveTargetScope(projectId, null, dto.targetTestCaseIds);

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
        status: dto.status ?? TestRunStatus.OPEN,
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
      additions.length > 0;

    if (!hasPayloadChanges) {
      throw new BadRequestException('Nothing to update.');
    }

    const hadCustomTargets = run.isTargetScopeCustom;
    let hasCustomTargets = hadCustomTargets;
    const currentTargets = this.buildTargetCaseSet(run.targetCaseIds);
    let targetsChanged = false;

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

  async getTestHealth(userId: string, featureId: string) {
    const projectId = await this.getProjectIdOrThrow(featureId);
    await assertProjectRead(this.prisma, userId, projectId);

    const latestRun = await this.prisma.testRun.findFirst({
      where: { featureId },
      orderBy: { runDate: 'desc' },
      include: { results: { select: { evaluation: true } } },
    });

    if (!latestRun) {
      return {
        featureId,
        lastRun: null,
        passRate: null,
      };
    }

    const total = latestRun.results.length;
    const passed = latestRun.results.filter(
      (result) => result.evaluation === TestEvaluation.PASSED,
    ).length;
    const passRate = total > 0 ? passed / total : null;

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

  private async buildCoverage(run: TestRunRecord): Promise<RunCoverage> {
    const executedIds = new Set(run.results.map((result) => result.testCaseId));
    if (run.isTargetScopeCustom) {
      if (run.targetCaseIds.length === 0) {
        return {
          scope: run.featureId ? 'FEATURE' : 'PROJECT',
          totalCases: 0,
          executedCases: 0,
          missingCases: 0,
          missingTestCases: [],
        };
      }
      const targetCases = await this.prisma.testCase.findMany({
        where: { id: { in: run.targetCaseIds } },
        select: {
          id: true,
          name: true,
          featureId: true,
          feature: { select: { id: true, name: true } },
        },
      });
      const orderMap = new Map(targetCases.map((testCase) => [testCase.id, testCase]));
      const orderedCases = run.targetCaseIds
        .map((id) => orderMap.get(id))
        .filter((testCase): testCase is (typeof targetCases)[number] => Boolean(testCase));
      const missingPlannedCases = orderedCases.filter((testCase) => !executedIds.has(testCase.id));
      const executedPlannedCases = orderedCases.length - missingPlannedCases.length;
      return {
        scope: run.featureId ? 'FEATURE' : 'PROJECT',
        totalCases: orderedCases.length,
        executedCases: executedPlannedCases,
        missingCases: missingPlannedCases.length,
        missingTestCases: missingPlannedCases.map((testCase) => ({
          id: testCase.id,
          name: testCase.name,
          featureId: testCase.featureId,
          featureName: testCase.feature?.name ?? 'Unknown feature',
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
}
