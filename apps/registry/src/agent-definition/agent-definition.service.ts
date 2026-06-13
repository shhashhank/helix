import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AgentDefinition, Prisma } from '@prisma/client';
import type { TenantScope } from '@helix/tenancy';
import { AgentDefinitionValidator } from '../validators/agent-definition.validator';
import { AgentDefinitionRepository, FindAllOptions } from './agent-definition.repository';
import {
  AgentDefinitionPayload,
  CreateAgentDefinitionInput,
  UpdateAgentDefinitionInput,
} from './dto/agent-definition.types';

@Injectable()
export class AgentDefinitionService {
  constructor(
    private readonly repo: AgentDefinitionRepository,
    private readonly validator: AgentDefinitionValidator,
  ) {}

  async create({ orgId, payload }: CreateAgentDefinitionInput): Promise<AgentDefinition> {
    this.validator.assertValid(payload);
    const existing = await this.repo.findMaxVersion(orgId, payload.role);
    if (existing !== null) {
      throw new ConflictException(
        `agent definition for role "${payload.role}" already exists; use update to add a new version`,
      );
    }
    return this.repo.create(buildRow({ orgId, payload, version: 1 }));
  }

  async update({ id, scope, payload }: UpdateAgentDefinitionInput): Promise<AgentDefinition> {
    this.validator.assertValid(payload);
    const current = await this.repo.findById(id, scope, true);
    if (!current) throw new NotFoundException(`agent definition ${id} not found`);
    if (current.role !== payload.role) {
      throw new ConflictException(
        `role mismatch: cannot change role from "${current.role}" to "${payload.role}" via update`,
      );
    }
    const maxVersion = (await this.repo.findMaxVersion(current.orgId, current.role)) ?? 0;
    return this.repo.create(
      buildRow({ orgId: current.orgId, payload, version: maxVersion + 1 }),
    );
  }

  async findById(id: string, scope: TenantScope, includeDeleted = false): Promise<AgentDefinition> {
    const row = await this.repo.findById(id, scope, includeDeleted);
    if (!row) throw new NotFoundException(`agent definition ${id} not found`);
    return row;
  }

  async findLatest(orgId: string | null, role: string): Promise<AgentDefinition> {
    const row = await this.repo.findLatestVersion(orgId, role);
    if (!row) {
      throw new NotFoundException(
        `no active agent definition for orgId=${orgId ?? 'null'} role=${role}`,
      );
    }
    return row;
  }

  findAll(orgId: string | null, opts?: FindAllOptions): Promise<AgentDefinition[]> {
    return this.repo.findAll(orgId, opts);
  }

  async softDelete(id: string, scope: TenantScope): Promise<AgentDefinition> {
    // Verify the row is in the caller's tenant before deleting — a cross-tenant id
    // is a 404, not a silent delete of someone else's definition (HELIX-143).
    const row = await this.repo.findById(id, scope, false);
    if (!row) throw new NotFoundException(`agent definition ${id} not found`);
    return this.repo.softDelete(id);
  }
}

function buildRow(args: {
  orgId: string | null;
  payload: AgentDefinitionPayload;
  version: number;
}): Prisma.AgentDefinitionUncheckedCreateInput {
  const { orgId, payload, version } = args;
  return {
    orgId,
    role: payload.role,
    version,
    name: payload.name,
    description: payload.description ?? null,
    systemPrompt: payload.systemPrompt as unknown as Prisma.InputJsonValue,
    modelPolicy: payload.modelPolicy as unknown as Prisma.InputJsonValue,
    tools: payload.tools as unknown as Prisma.InputJsonValue,
    guardrails: payload.guardrails as unknown as Prisma.InputJsonValue,
    outputSchema:
      payload.outputSchema === undefined
        ? Prisma.DbNull
        : (payload.outputSchema as Prisma.InputJsonValue),
    metadata:
      payload.metadata === undefined
        ? Prisma.DbNull
        : (payload.metadata as unknown as Prisma.InputJsonValue),
  };
}
