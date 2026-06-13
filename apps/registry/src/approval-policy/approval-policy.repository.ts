import { Injectable } from '@nestjs/common';
import { ApprovalPolicy, Prisma } from '@prisma/client';
import { type TenantScope, scopedWhere } from '@helix/tenancy';
import { PrismaService } from '../prisma/prisma.service';

export interface FindAllOptions {
  policyId?: string;
  includeAllVersions?: boolean;
  includeDeleted?: boolean;
  skip?: number;
  take?: number;
}

/**
 * Persistence for approval policies. Mirrors the agent-definition repository: rows
 * are immutable versions keyed by (orgId, policyId, version); the latest non-deleted
 * row per policyId is the active one.
 */
@Injectable()
export class ApprovalPolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ApprovalPolicyUncheckedCreateInput): Promise<ApprovalPolicy> {
    return this.prisma.approvalPolicy.create({ data });
  }

  /** Look up a row by id **within a tenant** — returns null for another org's row (HELIX-143). */
  findById(id: string, scope: TenantScope, includeDeleted = false): Promise<ApprovalPolicy | null> {
    return this.prisma.approvalPolicy.findFirst({
      where: scopedWhere(scope, { id, ...(includeDeleted ? {} : { deletedAt: null }) }),
    });
  }

  findLatestVersion(orgId: string | null, policyId: string): Promise<ApprovalPolicy | null> {
    return this.prisma.approvalPolicy.findFirst({
      where: { orgId, policyId, deletedAt: null },
      orderBy: { version: 'desc' },
    });
  }

  findMaxVersion(orgId: string | null, policyId: string): Promise<number | null> {
    return this.prisma.approvalPolicy
      .findFirst({
        where: { orgId, policyId },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      .then((row) => row?.version ?? null);
  }

  async findAll(
    orgId: string | null,
    { policyId, includeAllVersions, includeDeleted, skip = 0, take = 50 }: FindAllOptions = {},
  ): Promise<ApprovalPolicy[]> {
    if (includeAllVersions) {
      return this.prisma.approvalPolicy.findMany({
        where: {
          orgId,
          ...(policyId ? { policyId } : {}),
          ...(includeDeleted ? {} : { deletedAt: null }),
        },
        orderBy: [{ policyId: 'asc' }, { version: 'desc' }],
        skip,
        take,
      });
    }
    // Latest version per policyId — fetch ordered + reduce in JS (fine for MVP row counts).
    const rows = await this.prisma.approvalPolicy.findMany({
      where: { orgId, ...(policyId ? { policyId } : {}), ...(includeDeleted ? {} : { deletedAt: null }) },
      orderBy: [{ policyId: 'asc' }, { version: 'desc' }],
    });
    const latest = new Map<string, ApprovalPolicy>();
    for (const row of rows) if (!latest.has(row.policyId)) latest.set(row.policyId, row);
    return Array.from(latest.values()).slice(skip, skip + take);
  }

  softDelete(id: string): Promise<ApprovalPolicy> {
    return this.prisma.approvalPolicy.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
