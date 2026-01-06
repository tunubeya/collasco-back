import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AccessTokenPayload } from 'src/auth/types/jwt-payload';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { QaService } from './qa.service';
import { CreateTestCasesDto } from './dto/create-test-cases.dto';
import { UpdateTestCaseDto } from './dto/update-test-case.dto';
import { CreateTestRunDto } from './dto/create-test-run.dto';
import { CreateProjectTestRunDto } from './dto/create-project-test-run.dto';
import { UpsertResultsDto } from './dto/upsert-results.dto';
import { UpdateTestRunDto } from './dto/update-test-run.dto';
import { LinkFeatureDto } from './dto/link-feature.dto';

@Controller('qa')
export class QaController {
  constructor(private readonly qaService: QaService) {}

  @Post('features/:featureId/test-cases')
  async createTestCases(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Body() dto: CreateTestCasesDto,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.createTestCases(userId, featureId, dto);
  }

  @Get('features/:featureId/test-cases')
  async listTestCases(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const userId = this.resolveUserId(user);
    const include = includeArchived === 'true';
    return this.qaService.listTestCases(userId, featureId, include);
  }

  @Get('features/:featureId/linked-features')
  async listLinkedFeatures(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('featureId', ParseUUIDPipe) featureId: string,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.listLinkedFeatures(userId, featureId);
  }

  @Post('features/:featureId/linked-features')
  async linkFeature(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Body() dto: LinkFeatureDto,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.linkFeatures(userId, featureId, dto.targetFeatureId, dto.reason);
  }

  @Delete('features/:featureId/linked-features/:linkedFeatureId')
  async unlinkFeature(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Param('linkedFeatureId', ParseUUIDPipe) linkedFeatureId: string,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.unlinkFeatures(userId, featureId, linkedFeatureId);
  }

  @Patch('test-cases/:id')
  async updateTestCase(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('id', ParseUUIDPipe) testCaseId: string,
    @Body() dto: UpdateTestCaseDto,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.updateTestCase(userId, testCaseId, dto);
  }

  @Post('features/:featureId/test-runs')
  async createTestRun(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Body() dto: CreateTestRunDto,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.createTestRun(userId, featureId, dto);
  }

  @Post('projects/:projectId/test-runs')
  async createProjectTestRun(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateProjectTestRunDto,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.createProjectTestRun(userId, projectId, dto);
  }

  @Post('test-runs/:runId/results')
  async upsertResults(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: UpsertResultsDto,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.upsertResults(userId, runId, dto);
  }

  @Patch('test-runs/:runId')
  async updateTestRun(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: UpdateTestRunDto,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.updateTestRun(userId, runId, dto);
  }

  @Get('test-runs/:runId')
  async getTestRun(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.getTestRun(userId, runId);
  }

  @Get('features/:featureId/test-runs')
  async listTestRuns(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Query('limit') limit?: string,
  ) {
    const userId = this.resolveUserId(user);
    const parsedLimit = Number(limit ?? 10);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(Math.floor(parsedLimit), 50) : 10;
    return this.qaService.listTestRuns(userId, featureId, safeLimit);
  }

  @Get('projects/:projectId/test-runs')
  async listProjectTestRuns(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('limit') limit?: string,
    @Query('scope') scope?: string,
  ) {
    const userId = this.resolveUserId(user);
    const parsedLimit = Number(limit ?? 10);
    const safeLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(Math.floor(parsedLimit), 50) : 10;
    const normalizedScope = (scope ?? 'ALL').toUpperCase();
    if (!['ALL', 'PROJECT', 'FEATURE'].includes(normalizedScope)) {
      throw new BadRequestException('Invalid scope. Use ALL, PROJECT, or FEATURE.');
    }
    return this.qaService.listProjectTestRuns(
      userId,
      projectId,
      safeLimit,
      normalizedScope as 'ALL' | 'PROJECT' | 'FEATURE',
    );
  }

  @Get('projects/:projectId/dashboard')
  async getProjectDashboard(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.getProjectDashboard(userId, projectId);
  }

  @Get('projects/:projectId/dashboard/features-missing-description')
  async getProjectDashboardFeaturesMissingDescription(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: Record<string, string | string[] | undefined>,
  ) {
    const userId = this.resolveUserId(user);
    const options = this.resolveListQuery(query);
    return this.qaService.getProjectDashboardFeaturesMissingDescription(userId, projectId, options);
  }

  @Get('projects/:projectId/dashboard/features-without-testcases')
  async getProjectDashboardFeaturesWithoutTestCases(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: Record<string, string | string[] | undefined>,
  ) {
    const userId = this.resolveUserId(user);
    const options = this.resolveListQuery(query);
    return this.qaService.getProjectDashboardFeaturesWithoutTestCases(userId, projectId, options);

  }

  @Get('projects/:projectId/dashboard/feature-coverage')
  async getProjectDashboardFeatureCoverage(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: Record<string, string | string[] | undefined>,
  ) {
    const userId = this.resolveUserId(user);
    const options = this.resolveListQuery(query);
    return this.qaService.getProjectDashboardFeatureCoverage(userId, projectId, options);

  }

  @Get('projects/:projectId/dashboard/feature-health')
  async getProjectDashboardFeatureHealth(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: Record<string, string | string[] | undefined>,
  ) {
    const userId = this.resolveUserId(user);
    const options = this.resolveListQuery(query);
    return this.qaService.getProjectDashboardFeatureHealth(userId, projectId, options);
  }

  @Get('projects/:projectId/dashboard/open-runs')
  async getProjectDashboardOpenRuns(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: Record<string, string | string[] | undefined>,
  ) {
    const userId = this.resolveUserId(user);
    const options = this.resolveListQuery(query);
    return this.qaService.getProjectDashboardOpenRuns(userId, projectId, options);
  }

  @Get('projects/:projectId/dashboard/runs-with-full-pass')
  async getProjectDashboardRunsWithFullPass(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: Record<string, string | string[] | undefined>,
  ) {
    const userId = this.resolveUserId(user);
    const options = this.resolveListQuery(query);
    return this.qaService.getProjectDashboardRunsWithFullPass(userId, projectId, options);
  }

  @Get('features/:featureId/test-health')
  async getTestHealth(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('featureId', ParseUUIDPipe) featureId: string,
  ) {
    const userId = this.resolveUserId(user);
    return this.qaService.getTestHealth(userId, featureId);
  }

  private resolveUserId(user: AccessTokenPayload | undefined): string {
    if (user?.sub) {
      return user.sub;
    }
    if ((user as unknown as { id?: string })?.id) {
      return (user as unknown as { id: string }).id;
    }
    // TODO: replace stub once authentication pipeline guarantees req.user.id
    return 'stub-user-id';
  }

  private resolvePagination(page?: string, pageSize?: string) {
    const parsedPage = Number(page ?? 1);
    const parsedPageSize = Number(pageSize ?? 20);
    const safePage = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.min(Math.floor(parsedPage), 1000) : 1;
    const safePageSize =
      Number.isFinite(parsedPageSize) && parsedPageSize > 0 ? Math.min(Math.floor(parsedPageSize), 100) : 20;
    return { page: safePage, pageSize: safePageSize };
  }

  private resolveListQuery(query: Record<string, string | string[] | undefined>) {
    const page = this.extractQueryValue(query.page);
    const pageSize = this.extractQueryValue(query.pageSize);
    const sort = this.extractQueryValue(query.sort);
    const filterEntries = Object.entries(query)
      .filter(([key]) => !['page', 'pageSize', 'sort'].includes(key))
      .map(([key, value]) => [key, this.extractQueryValue(value)])
      .filter(([, value]) => value !== undefined) as Array<[string, string]>;
    const filters = Object.fromEntries(filterEntries) as Record<string, string | undefined>;
    return {
      pagination: this.resolvePagination(page, pageSize),
      sort,
      filters,
    };
  }

  private extractQueryValue(value?: string | string[]) {
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }
}
