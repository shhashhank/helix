import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AgentDefinitionPayload } from './agent-definition.types';

/**
 * OpenAPI documentation shape for the agent-definition request body. The
 * authoritative contract is the JSON Schema at
 * schemas/agent-definition/v1/agent-definition.schema.json, enforced by the
 * AgentDefinitionValidator. This class documents the top-level fields for
 * Swagger; nested objects are described but not re-validated here.
 */
export class AgentDefinitionBodyDto implements Partial<AgentDefinitionPayload> {
  @ApiProperty({ example: '1.0.0', description: 'Schema (SemVer) the payload conforms to' })
  schemaVersion!: string;

  @ApiPropertyOptional({ description: 'Client-supplied identifier (informational)' })
  id?: string;

  @ApiProperty({ example: 'Planning Agent' })
  name!: string;

  @ApiPropertyOptional({ example: 'Turns requests into implementation plans' })
  description?: string;

  @ApiProperty({
    enum: ['planning', 'coding', 'code_review', 'testing', 'deployment', 'custom'],
    example: 'planning',
  })
  role!: AgentDefinitionPayload['role'];

  @ApiProperty({ example: '1.0.0', description: 'Author-facing SemVer; storage versioning is internal' })
  version!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Prompt template + variables' })
  systemPrompt!: AgentDefinitionPayload['systemPrompt'];

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Model tier, fallbacks, ceilings' })
  modelPolicy!: AgentDefinitionPayload['modelPolicy'];

  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  tools!: AgentDefinitionPayload['tools'];

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Step/token/cost limits' })
  guardrails!: AgentDefinitionPayload['guardrails'];

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  outputSchema?: AgentDefinitionPayload['outputSchema'];

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  metadata?: AgentDefinitionPayload['metadata'];
}

/** Query params for `GET /agents`. */
export class ListAgentDefinitionsQueryDto {
  @ApiPropertyOptional({ description: 'Filter to a single role' })
  role?: string;

  @ApiPropertyOptional({
    description: 'Return every stored version instead of only the latest per role',
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
export class AgentDefinitionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) orgId!: string | null;
  @ApiProperty() role!: string;
  @ApiProperty({ description: 'Internal monotonic version' }) version!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) systemPrompt!: unknown;
  @ApiProperty({ type: 'object', additionalProperties: true }) modelPolicy!: unknown;
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) tools!: unknown;
  @ApiProperty({ type: 'object', additionalProperties: true }) guardrails!: unknown;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) outputSchema!: unknown;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) metadata!: unknown;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ nullable: true }) deletedAt!: Date | null;
}
