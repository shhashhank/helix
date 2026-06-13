import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { AuthPrincipal } from '@helix/auth';
import type { WorkflowDefinition } from '@helix/workflow';
import { AuthGuard } from '../auth/auth.guard';
import { Principal } from '../auth/principal.decorator';
import { BuildRequest } from './request.model';
import { RequestService } from './request.service';
import { BuildRequestDto, SubmitRequestDto } from './dto/request.dto';

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

  @Get(':id')
  @ApiOperation({ summary: 'Get one build request (tenant-scoped — 404 across tenants)' })
  @ApiOkResponse({ type: BuildRequestDto })
  get(@Param('id') id: string, @Principal() principal: AuthPrincipal): Promise<BuildRequest> {
    return this.service.get(id, principal);
  }
}
