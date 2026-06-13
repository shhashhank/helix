import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AgentDefinition } from '@prisma/client';
import { AgentDefinitionService } from './agent-definition.service';
import {
  AgentDefinitionBodyDto,
  AgentDefinitionResponseDto,
  ListAgentDefinitionsQueryDto,
} from './dto/agent-definition-http.dto';
import { AgentDefinitionPayload } from './dto/agent-definition.types';
import { tenantScope } from '@helix/tenancy';
import { ORG_HEADER, OrgId } from './org-id.decorator';

function asBool(v?: string): boolean {
  return v === 'true' || v === '1';
}

function asInt(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Documents the optional tenant header on org-scoped routes (see {@link OrgId}). */
const ApiOrgHeader = () =>
  ApiHeader({
    name: ORG_HEADER,
    required: false,
    description: 'Tenant org UUID; omit for the shared namespace',
  });

@ApiTags('agent-definitions')
@Controller('agents')
export class AgentDefinitionController {
  constructor(private readonly service: AgentDefinitionService) {}

  @Post()
  @ApiOrgHeader()
  @ApiOperation({ summary: 'Create the first version of an agent definition for a role' })
  @ApiCreatedResponse({ type: AgentDefinitionResponseDto })
  create(
    @Body() body: AgentDefinitionBodyDto,
    @OrgId() orgId: string | null,
  ): Promise<AgentDefinition> {
    return this.service.create({ orgId, payload: body as unknown as AgentDefinitionPayload });
  }

  @Get()
  @ApiOrgHeader()
  @ApiOperation({ summary: 'List agent definitions (latest per role by default)' })
  @ApiOkResponse({ type: AgentDefinitionResponseDto, isArray: true })
  findAll(
    @Query() query: ListAgentDefinitionsQueryDto,
    @OrgId() orgId: string | null,
  ): Promise<AgentDefinition[]> {
    return this.service.findAll(orgId, {
      role: query.role,
      includeAllVersions: asBool(query.includeAllVersions),
      includeDeleted: asBool(query.includeDeleted),
      skip: asInt(query.skip, 0),
      take: asInt(query.take, 50),
    });
  }

  @Get('latest')
  @ApiOrgHeader()
  @ApiOperation({ summary: 'Get the latest active definition for a role' })
  @ApiQuery({ name: 'role', required: true })
  @ApiOkResponse({ type: AgentDefinitionResponseDto })
  findLatest(
    @Query('role') role: string,
    @OrgId() orgId: string | null,
  ): Promise<AgentDefinition> {
    return this.service.findLatest(orgId, role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single agent definition by id' })
  @ApiQuery({ name: 'includeDeleted', required: false, type: Boolean })
  @ApiOkResponse({ type: AgentDefinitionResponseDto })
  findById(
    @Param('id') id: string,
    @OrgId() orgId: string | null,
    @Query('includeDeleted') includeDeleted?: string,
  ): Promise<AgentDefinition> {
    return this.service.findById(id, tenantScope(orgId), asBool(includeDeleted));
  }

  @Put(':id')
  @ApiOperation({ summary: 'Add a new version of an existing definition (immutable update)' })
  @ApiOkResponse({ type: AgentDefinitionResponseDto })
  update(
    @Param('id') id: string,
    @OrgId() orgId: string | null,
    @Body() body: AgentDefinitionBodyDto,
  ): Promise<AgentDefinition> {
    return this.service.update({ id, scope: tenantScope(orgId), payload: body as unknown as AgentDefinitionPayload });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a definition version' })
  @ApiOkResponse({ type: AgentDefinitionResponseDto })
  remove(@Param('id') id: string, @OrgId() orgId: string | null): Promise<AgentDefinition> {
    return this.service.softDelete(id, tenantScope(orgId));
  }
}
