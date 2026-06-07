import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Body for opening an approval request against a run. */
export class OpenApprovalDto {
  @ApiProperty({ description: 'The workflow run this gate is attached to', example: 'run-7' })
  workflowId!: string;

  @ApiProperty({ description: 'What needs sign-off', example: 'deploy prod' })
  action!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Resolved policy requirement: approverRoles, minApprovals, slaMinutes?, escalateTo',
    example: { approverRoles: ['tech-lead'], minApprovals: 1, slaMinutes: 60, escalateTo: [] },
  })
  requirement!: {
    approverRoles: string[];
    minApprovals: number;
    slaMinutes?: number;
    escalateTo: string[];
  };

  @ApiPropertyOptional({ description: 'Who/what raised the request' })
  requestedBy?: string;

  @ApiPropertyOptional({ description: 'Why approval is needed' })
  reason?: string;
}

/** Body for submitting one approver's decision. */
export class SubmitDecisionDto {
  @ApiProperty({ description: 'Approver identity (counted distinctly toward quorum)', example: 'alice' })
  approver!: string;

  @ApiProperty({ description: 'Role they act as; must be an approver role on the request', example: 'tech-lead' })
  role!: string;

  @ApiProperty({ enum: ['approve', 'reject'], example: 'approve' })
  vote!: 'approve' | 'reject';

  @ApiPropertyOptional({ description: 'Optional comment recorded with the decision' })
  comment?: string;
}

/** Body for cancelling a pending request. */
export class CancelApprovalDto {
  @ApiPropertyOptional({ description: 'Why the request was cancelled' })
  reason?: string;
}

/** Body for the escalation sweep. */
export class EscalateDueDto {
  @ApiPropertyOptional({
    description: 'Minutes before the SLA deadline to escalate (default 0)',
    type: Number,
    example: 15,
  })
  beforeExpiryMinutes?: number;
}

/** One inbox row: a pending request with quorum progress + SLA (mirrors `InboxItem`). */
export class InboxItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() action!: string;
  @ApiPropertyOptional({ description: 'The gated run id' }) subjectId?: string;
  @ApiPropertyOptional() requestedBy?: string;
  @ApiPropertyOptional() reason?: string;
  @ApiProperty({ type: [String] }) approverRoles!: string[];
  @ApiProperty({ description: 'Distinct approvals so far' }) approvals!: number;
  @ApiProperty({ description: 'Quorum required' }) required!: number;
  @ApiProperty({ description: 'Approvals still needed' }) remaining!: number;
  @ApiProperty() rejections!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ description: 'Seconds since the request opened' }) ageSeconds!: number;
  @ApiPropertyOptional() slaMinutes?: number;
  @ApiPropertyOptional() expiresAt?: string;
  @ApiPropertyOptional({ description: 'Seconds until the SLA lapses' }) slaRemainingSeconds?: number;
  @ApiProperty({ type: [String], description: 'Roles that have cast a decision' }) rolesDecided!: string[];
  @ApiProperty({ type: [String], description: 'Approver roles nobody has voted yet' }) awaitingRoles!: string[];
}

/** Approval request as returned by the API (mirrors the `@helix/approvals` model). */
export class ApprovalRequestDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['pending', 'approved', 'rejected', 'expired', 'cancelled'] }) status!: string;
  @ApiProperty({ type: [String] }) approverRoles!: string[];
  @ApiProperty() minApprovals!: number;
  @ApiProperty({ type: [String] }) escalateTo!: string[];
  @ApiProperty() action!: string;
  @ApiPropertyOptional({ description: 'The gated run id' }) subjectId?: string;
  @ApiPropertyOptional() requestedBy?: string;
  @ApiPropertyOptional() reason?: string;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional() slaMinutes?: number;
  @ApiPropertyOptional() expiresAt?: string;
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) decisions!: unknown[];
  @ApiPropertyOptional() resolvedAt?: string;
  @ApiPropertyOptional({ description: 'When the request was escalated to backups' }) escalatedAt?: string;
}
