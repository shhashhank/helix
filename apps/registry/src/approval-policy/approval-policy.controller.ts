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
import { ApprovalPolicy } from '@prisma/client';
import { ORG_HEADER, OrgId } from '../agent-definition/org-id.decorator';
import { ApprovalPolicyService } from './approval-policy.service';
import {
  ApprovalPolicyBodyDto,
  ApprovalPolicyResponseDto,
  ListApprovalPoliciesQueryDto,
} from './dto/approval-policy-http.dto';

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

@ApiTags('approval-policies')
@Controller('approval-policies')
export class ApprovalPolicyController {
  constructor(private readonly service: ApprovalPolicyService) {}

  @Post()
  @ApiOrgHeader()
  @ApiOperation({ summary: 'Create the first version of an approval policy' })
  @ApiCreatedResponse({ type: ApprovalPolicyResponseDto })
  create(@Body() body: ApprovalPolicyBodyDto, @OrgId() orgId: string | null): Promise<ApprovalPolicy> {
    return this.service.create({ orgId, document: body });
  }

  @Get()
  @ApiOrgHeader()
  @ApiOperation({ summary: 'List approval policies (latest per policy id by default)' })
  @ApiOkResponse({ type: ApprovalPolicyResponseDto, isArray: true })
  findAll(
    @Query() query: ListApprovalPoliciesQueryDto,
    @OrgId() orgId: string | null,
  ): Promise<ApprovalPolicy[]> {
    return this.service.findAll(orgId, {
      policyId: query.policyId,
      includeAllVersions: asBool(query.includeAllVersions),
      includeDeleted: asBool(query.includeDeleted),
      skip: asInt(query.skip, 0),
      take: asInt(query.take, 50),
    });
  }

  @Get('latest')
  @ApiOrgHeader()
  @ApiOperation({ summary: 'Get the latest active version of a policy' })
  @ApiQuery({ name: 'policyId', required: true })
  @ApiOkResponse({ type: ApprovalPolicyResponseDto })
  findLatest(
    @Query('policyId') policyId: string,
    @OrgId() orgId: string | null,
  ): Promise<ApprovalPolicy> {
    return this.service.findLatest(orgId, policyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single approval policy version by row id' })
  @ApiQuery({ name: 'includeDeleted', required: false, type: Boolean })
  @ApiOkResponse({ type: ApprovalPolicyResponseDto })
  findById(
    @Param('id') id: string,
    @Query('includeDeleted') includeDeleted?: string,
  ): Promise<ApprovalPolicy> {
    return this.service.findById(id, asBool(includeDeleted));
  }

  @Put(':id')
  @ApiOperation({ summary: 'Add a new version of an existing policy (immutable update)' })
  @ApiOkResponse({ type: ApprovalPolicyResponseDto })
  update(@Param('id') id: string, @Body() body: ApprovalPolicyBodyDto): Promise<ApprovalPolicy> {
    return this.service.update({ id, document: body });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a policy version' })
  @ApiOkResponse({ type: ApprovalPolicyResponseDto })
  remove(@Param('id') id: string): Promise<ApprovalPolicy> {
    return this.service.softDelete(id);
  }
}
