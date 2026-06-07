import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * OpenAPI documentation shape for the approval-policy request body. The
 * authoritative contract is the zod schema in `@helix/approvals` (HELIX-128),
 * enforced by the service. This class documents the top-level fields for Swagger;
 * the gate rules are described generically rather than re-validated here.
 */
export class ApprovalPolicyBodyDto {
  @ApiProperty({ example: 'default', description: 'Logical policy id (stable across versions)' })
  id!: string;

  @ApiProperty({ example: 1, description: 'Author-facing version; storage versioning is internal' })
  version!: number;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Gate rules: each pairs a `when` condition with a `require` block (roles/quorum/SLA)',
  })
  rules!: unknown[];
}

/** Query params for `GET /approval-policies`. */
export class ListApprovalPoliciesQueryDto {
  @ApiPropertyOptional({ description: 'Filter to a single logical policy id' })
  policyId?: string;

  @ApiPropertyOptional({
    description: 'Return every stored version instead of only the latest per policy id',
    type: Boolean,
  })
  includeAllVersions?: string;

  @ApiPropertyOptional({ description: 'Include soft-deleted rows', type: Boolean })
  includeDeleted?: string;

  @ApiPropertyOptional({ description: 'Pagination offset', type: Number, example: 0 })
  skip?: string;

  @ApiPropertyOptional({ description: 'Page size (default 50)', type: Number, example: 50 })
  take?: string;
}

/** Stored row as returned by the API (mirrors the Prisma model). */
export class ApprovalPolicyResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) orgId!: string | null;
  @ApiProperty({ description: 'Logical policy id' }) policyId!: string;
  @ApiProperty({ description: 'Internal monotonic version' }) version!: number;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'The validated policy document' })
  document!: unknown;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ nullable: true }) deletedAt!: Date | null;
}
