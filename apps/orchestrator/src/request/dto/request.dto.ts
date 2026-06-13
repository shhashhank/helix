import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Body for submitting a build request. */
export class SubmitRequestDto {
  @ApiProperty({ description: 'Short human title for the request' })
  title!: string;

  @ApiProperty({ description: 'What to build, in your words' })
  prompt!: string;

  @ApiPropertyOptional({
    type: Object,
    description: 'Explicit workflow DSL ({ name, steps[], edges[] }); defaults to the standard pipeline',
  })
  workflow?: Record<string, unknown>;
}

/** A recorded build request and the run it started. */
export class BuildRequestDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Owning org/tenant' }) orgId!: string | null;
  @ApiProperty() submittedBy!: string;
  @ApiProperty() title!: string;
  @ApiProperty() prompt!: string;
  @ApiProperty({ description: 'Submission status (the run status lives on the run API)' }) status!: string;
  @ApiProperty() workflowId!: string;
  @ApiProperty() runId!: string;
  @ApiProperty({ description: 'W3C trace id for the run (paste into Grafana/Tempo)' }) traceId!: string;
  @ApiProperty() createdAt!: string;
}
