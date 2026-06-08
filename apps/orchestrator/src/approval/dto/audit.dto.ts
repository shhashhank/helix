import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Query filters for the audit endpoints. */
export class AuditQueryDto {
  @ApiPropertyOptional({ description: 'Subject type, e.g. approval' })
  subjectType?: string;

  @ApiPropertyOptional({ description: 'Subject id, e.g. an approval request id' })
  subjectId?: string;

  @ApiPropertyOptional({ description: 'Event type, e.g. approval.decision' })
  type?: string;

  @ApiPropertyOptional({ description: 'Most-recent N events', type: Number })
  limit?: string;
}

/** A stored, hash-chained audit event (mirrors `@helix/audit` `AuditEvent`). */
export class AuditEventDto {
  @ApiProperty() id!: string;
  @ApiProperty() type!: string;
  @ApiProperty() occurredAt!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, description: '{ type, id }' }) subject!: unknown;
  @ApiPropertyOptional() actor?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) data?: Record<string, unknown>;
  @ApiProperty({ description: '0-based position in the chain' }) sequence!: number;
  @ApiProperty() prevHash!: string;
  @ApiProperty({ description: 'sha256(prevHash + canonical(event))' }) hash!: string;
}

/** Result of the chain-integrity check. */
export class AuditVerificationDto {
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ description: 'Index of the first broken link, if any' }) brokenAt?: number;
  @ApiPropertyOptional() reason?: string;
}
