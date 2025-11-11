import {
  Body,
  Controller,
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
import { UpsertResultsDto } from './dto/upsert-results.dto';
import { CreateProjectTestRunDto } from './dto/create-project-test-run.dto';

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
  ) {
    const userId = this.resolveUserId(user);
    const parsedLimit = Number(limit ?? 10);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(Math.floor(parsedLimit), 50) : 10;
    return this.qaService.listProjectTestRuns(userId, projectId, safeLimit);
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
}
