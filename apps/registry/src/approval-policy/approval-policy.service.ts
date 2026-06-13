import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalPolicy as ApprovalPolicyRow, Prisma } from '@prisma/client';
import { ApprovalPolicy as ApprovalPolicyDoc, safeParseApprovalPolicy } from '@helix/approvals';
import type { TenantScope } from '@helix/tenancy';
import { ApprovalPolicyRepository, FindAllOptions } from './approval-policy.repository';

export interface CreateApprovalPolicyInput {
  orgId: string | null;
  document: unknown;
}

export interface UpdateApprovalPolicyInput {
  id: string;
  /** Tenant the update is scoped to — a cross-tenant id is treated as not found. */
  scope: TenantScope;
  document: unknown;
}

/**
 * The admin surface for approval policies (HELIX-129). Validates the document with
 * the single-sourced `@helix/approvals` schema (HELIX-128), then stores it under the
 * same immutable-versioning model as agent definitions: create opens version 1 for a
 * new `policyId`; update appends the next version; the latest non-deleted row is active.
 */
@Injectable()
export class ApprovalPolicyService {
  constructor(private readonly repo: ApprovalPolicyRepository) {}

  private validate(document: unknown): ApprovalPolicyDoc {
    const result = safeParseApprovalPolicy(document);
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'approval policy failed schema validation',
        validationErrors: result.error.issues.map((issue) => ({
          path: '/' + issue.path.join('/'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }

  async create({ orgId, document }: CreateApprovalPolicyInput): Promise<ApprovalPolicyRow> {
    const doc = this.validate(document);
    const existing = await this.repo.findMaxVersion(orgId, doc.id);
    if (existing !== null) {
      throw new ConflictException(
        `approval policy "${doc.id}" already exists; use update to add a new version`,
      );
    }
    return this.repo.create(buildRow({ orgId, doc, version: 1 }));
  }

  async update({ id, scope, document }: UpdateApprovalPolicyInput): Promise<ApprovalPolicyRow> {
    const doc = this.validate(document);
    const current = await this.repo.findById(id, scope, true);
    if (!current) throw new NotFoundException(`approval policy ${id} not found`);
    if (current.policyId !== doc.id) {
      throw new ConflictException(
        `policy id mismatch: cannot change id from "${current.policyId}" to "${doc.id}" via update`,
      );
    }
    const maxVersion = (await this.repo.findMaxVersion(current.orgId, current.policyId)) ?? 0;
    return this.repo.create(buildRow({ orgId: current.orgId, doc, version: maxVersion + 1 }));
  }

  async findById(id: string, scope: TenantScope, includeDeleted = false): Promise<ApprovalPolicyRow> {
    const row = await this.repo.findById(id, scope, includeDeleted);
    if (!row) throw new NotFoundException(`approval policy ${id} not found`);
    return row;
  }

  async findLatest(orgId: string | null, policyId: string): Promise<ApprovalPolicyRow> {
    const row = await this.repo.findLatestVersion(orgId, policyId);
    if (!row) {
      throw new NotFoundException(
        `no active approval policy for orgId=${orgId ?? 'null'} policyId=${policyId}`,
      );
    }
    return row;
  }

  findAll(orgId: string | null, opts?: FindAllOptions): Promise<ApprovalPolicyRow[]> {
    return this.repo.findAll(orgId, opts);
  }

  async softDelete(id: string, scope: TenantScope): Promise<ApprovalPolicyRow> {
    // Confirm the row is in the caller's tenant before deleting (HELIX-143).
    const row = await this.repo.findById(id, scope, false);
    if (!row) throw new NotFoundException(`approval policy ${id} not found`);
    return this.repo.softDelete(id);
  }
}

function buildRow(args: {
  orgId: string | null;
  doc: ApprovalPolicyDoc;
  version: number;
}): Prisma.ApprovalPolicyUncheckedCreateInput {
  const { orgId, doc, version } = args;
  // Storage versioning is authoritative: normalize the document's own version to the
  // stored monotonic version so the persisted policy is internally consistent.
  const document = { ...doc, version };
  return {
    orgId,
    policyId: doc.id,
    version,
    document: document as unknown as Prisma.InputJsonValue,
  };
}
