import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Body for starting a run: the workflow DSL plus an optional explicit run id. */
export class StartRunDto {
  @ApiProperty({
    type: Object,
    description: 'The workflow definition (DSL): { name, steps[], edges[] }',
  })
  workflow!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Explicit run id; auto-generated when omitted' })
  workflowId?: string;
}

/** Body for retrying a failed run: the workflow DSL to re-run under the same id. */
export class RetryRunDto {
  @ApiProperty({ type: Object, description: 'The workflow definition to re-run' })
  workflow!: Record<string, unknown>;
}

/** Returned when a run is started or retried. */
export class StartedRunDto {
  @ApiProperty() workflowId!: string;
  @ApiProperty() runId!: string;
  @ApiProperty({ description: 'W3C trace id for this run — paste into Grafana/Tempo to find its trace' })
  traceId!: string;
  @ApiProperty({ description: 'W3C traceparent for this run (also returned as a response header)' })
  traceparent!: string;
}

/** A run's lifecycle status. */
export class RunStatusDto {
  @ApiProperty() workflowId!: string;
  @ApiProperty() runId!: string;
  @ApiProperty({ description: 'RUNNING | COMPLETED | FAILED | CANCELLED | TERMINATED | TIMED_OUT | …' })
  status!: string;
  @ApiPropertyOptional() startTime?: string;
  @ApiPropertyOptional() closeTime?: string;
  @ApiPropertyOptional({ description: 'W3C trace id correlating this run with its telemetry' })
  traceId?: string;
  @ApiPropertyOptional({ description: "The run's W3C traceparent, if recorded at start" })
  traceparent?: string;
}
