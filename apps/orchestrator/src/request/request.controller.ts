import { Body, Controller, Get, MessageEvent, Param, Post, Query, Sse, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { AuthPrincipal } from '@helix/auth';
import type { WorkflowDefinition } from '@helix/workflow';
import type { RunStatus } from '@helix/workflow/temporal-client';
import { AuthGuard } from '../auth/auth.guard';
import { Principal } from '../auth/principal.decorator';
import { RunStatusDto } from '../workflow-run/dto/workflow-run.dto';
import { BuildRequest } from './request.model';
import { DashboardItem, RequestService } from './request.service';
import { BuildRequestDto, DashboardItemDto, SubmitRequestDto } from './dto/request.dto';

/**
 * Build-request API (HELIX-145). The whole controller requires a session — every
 * request is owned by the authenticated principal and scoped to its org. The
 * rendered submission form / list UI is deferred (API-first).
 */
@ApiTags('requests')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired session' })
@UseGuards(AuthGuard)
@Controller('requests')
export class RequestController {
  constructor(private readonly service: RequestService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a build request — starts a workflow run' })
  @ApiCreatedResponse({ type: BuildRequestDto })
  submit(@Body() body: SubmitRequestDto, @Principal() principal: AuthPrincipal): Promise<BuildRequest> {
    return this.service.submit(
      { title: body.title, prompt: body.prompt, workflow: body.workflow as unknown as WorkflowDefinition | undefined },
      principal,
    );
  }

  @Get()
  @ApiOperation({ summary: "List the caller org's build requests (newest first)" })
  @ApiQuery({ name: 'mine', required: false, type: Boolean, description: 'Only requests you submitted' })
  @ApiOkResponse({ type: BuildRequestDto, isArray: true })
  list(@Principal() principal: AuthPrincipal, @Query('mine') mine?: string): Promise<BuildRequest[]> {
    return this.service.list(principal, mine === 'true');
  }

  @Get('overview')
  @ApiOperation({ summary: "Run dashboard — the caller org's requests joined with each run's status" })
  @ApiQuery({ name: 'mine', required: false, type: Boolean, description: 'Only requests you submitted' })
  @ApiOkResponse({ type: DashboardItemDto, isArray: true })
  overview(@Principal() principal: AuthPrincipal, @Query('mine') mine?: string): Promise<DashboardItem[]> {
    return this.service.overview(principal, mine === 'true');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one build request (tenant-scoped — 404 across tenants)' })
  @ApiOkResponse({ type: BuildRequestDto })
  get(@Param('id') id: string, @Principal() principal: AuthPrincipal): Promise<BuildRequest> {
    return this.service.get(id, principal);
  }

  @Get(':id/run')
  @ApiOperation({ summary: "Current run status for a request's run (tenant-scoped)" })
  @ApiOkResponse({ type: RunStatusDto })
  runStatus(@Param('id') id: string, @Principal() principal: AuthPrincipal): Promise<RunStatus> {
    return this.service.runStatus(id, principal);
  }

  @Sse(':id/stream')
  @ApiOperation({ summary: "Live per-step status for a request's run (Server-Sent Events)" })
  stream(@Param('id') id: string, @Principal() principal: AuthPrincipal): Observable<MessageEvent> {
    return this.service.streamProgress(id, principal).pipe(map((progress): MessageEvent => ({ data: progress })));
  }
}
