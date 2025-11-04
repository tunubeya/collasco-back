import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TestEvaluation } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTestCasesDto } from './dto/create-test-cases.dto';
import { UpdateTestCaseDto } from './dto/update-test-case.dto';
import { CreateTestRunDto, TestResultInput } from './dto/create-test-run.dto';
import { UpsertResultsDto } from './dto/upsert-results.dto';
import { assertProjectRead, assertProjectWrite } from './guards/rbac.helpers';

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
  runBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  results: {
    include: {
      testCase: true,
    },
  },
};

type TestRunDetail = Prisma.TestRunGetPayload<{
  include: typeof testRunDetailInclude;
}>;

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

  async createTestRun(userId: string, featureId: string, dto: CreateTestRunDto): Promise<TestRunDetail> {
    const projectId = await this.getProjectIdOrThrow(featureId);
    await assertProjectWrite(this.prisma, userId, projectId);

    const results = dto.results ?? [];
    this.ensureUniqueTestCaseIds(results);
    await this.validateTestCasesBelongToFeature(featureId, results.map((r) => r.testCaseId));

    const run = await this.prisma.testRun.create({
      data: {
        featureId,
        runById: dto.runById,
        notes: dto.notes,
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

  async upsertResults(userId: string, runId: string, dto: UpsertResultsDto): Promise<TestRunDetail> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      select: { id: true, featureId: true },
    });
    if (!run) {
      throw new NotFoundException('Test run not found.');
    }

    const projectId = await this.getProjectIdOrThrow(run.featureId);
    await assertProjectWrite(this.prisma, userId, projectId);

    this.ensureUniqueTestCaseIds(dto.results);
    await this.validateTestCasesBelongToFeature(run.featureId, dto.results.map((r) => r.testCaseId));

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

    return this.getTestRunDetail(runId);
  }

  async getTestRun(userId: string, runId: string): Promise<TestRunDetail> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      select: { featureId: true },
    });
    if (!run) {
      throw new NotFoundException('Test run not found.');
    }

    const projectId = await this.getProjectIdOrThrow(run.featureId);
    await assertProjectRead(this.prisma, userId, projectId);

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
      by: run.runBy?.name ?? null,
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
    const passed = latestRun.results.filter((result) => result.evaluation === TestEvaluation.PASSED).length;
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

  private async validateTestCasesBelongToFeature(featureId: string, testCaseIds: string[]): Promise<void> {
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
    return run;
  }
}
