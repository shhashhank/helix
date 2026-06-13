import { Injectable } from '@nestjs/common';
import { AgentDefinition, Prisma } from '@prisma/client';
import { type TenantScope, scopedWhere } from '@helix/tenancy';
import { PrismaService } from '../prisma/prisma.service';

export interface FindAllOptions {
  role?: string;
  includeAllVersions?: boolean;
  includeDeleted?: boolean;
  skip?: number;
  take?: number;
}

@Injectable()
export class AgentDefinitionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.AgentDefinitionUncheckedCreateInput): Promise<AgentDefinition> {
    return this.prisma.agentDefinition.create({ data });
  }

  /** Look up a row by id **within a tenant** — returns null for another org's row (HELIX-143). */
  findById(id: string, scope: TenantScope, includeDeleted = false): Promise<AgentDefinition | null> {
    return this.prisma.agentDefinition.findFirst({
      where: scopedWhere(scope, { id, ...(includeDeleted ? {} : { deletedAt: null }) }),
    });
  }

  findLatestVersion(orgId: string | null, role: string): Promise<AgentDefinition | null> {
    return this.prisma.agentDefinition.findFirst({
      where: { orgId, role, deletedAt: null },
      orderBy: { version: 'desc' },
    });
  }

  findMaxVersion(orgId: string | null, role: string): Promise<number | null> {
    return this.prisma.agentDefinition
      .findFirst({
        where: { orgId, role },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      .then((row) => row?.version ?? null);
  }

  async findAll(
    orgId: string | null,
    { role, includeAllVersions, includeDeleted, skip = 0, take = 50 }: FindAllOptions = {},
  ): Promise<AgentDefinition[]> {
    if (includeAllVersions) {
      return this.prisma.agentDefinition.findMany({
        where: {
          orgId,
          ...(role ? { role } : {}),
          ...(includeDeleted ? {} : { deletedAt: null }),
        },
        orderBy: [{ role: 'asc' }, { version: 'desc' }],
        skip,
        take,
      });
    }
    // Latest version per role (window via DISTINCT ON would be cleaner; for MVP we
    // fetch all + reduce in JS — fine until row counts grow).
    const rows = await this.prisma.agentDefinition.findMany({
      where: { orgId, ...(role ? { role } : {}), ...(includeDeleted ? {} : { deletedAt: null }) },
      orderBy: [{ role: 'asc' }, { version: 'desc' }],
    });
    const latest = new Map<string, AgentDefinition>();
    for (const row of rows) if (!latest.has(row.role)) latest.set(row.role, row);
    return Array.from(latest.values()).slice(skip, skip + take);
  }

  softDelete(id: string): Promise<AgentDefinition> {
    return this.prisma.agentDefinition.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
