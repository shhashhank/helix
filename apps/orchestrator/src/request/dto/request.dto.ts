import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RunStatusDto } from '../../workflow-run/dto/workflow-run.dto';

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

/** A run-dashboard row: a request joined with its run's current status (HELIX-146). */
export class DashboardItemDto {
  @ApiProperty({ type: BuildRequestDto }) request!: BuildRequestDto;
  @ApiProperty({ type: RunStatusDto }) run!: RunStatusDto;
}

class PullRequestArtifactDto {
  @ApiProperty() url!: string;
  @ApiPropertyOptional() title?: string;
}
class TestsArtifactDto {
  @ApiProperty() passed!: number;
  @ApiProperty() failed!: number;
  @ApiPropertyOptional() coverage?: number;
}
class DeploymentArtifactDto {
  @ApiProperty() url!: string;
  @ApiPropertyOptional() environment?: string;
}
class ChangeSetArtifactDto {
  @ApiProperty() filesChanged!: number;
  @ApiProperty() additions!: number;
  @ApiProperty() deletions!: number;
}

/** The outputs a run produced — each present only once its step has run (HELIX-147). */
export class RunArtifactsDto {
  @ApiPropertyOptional({ type: PullRequestArtifactDto }) pullRequest?: PullRequestArtifactDto;
  @ApiPropertyOptional({ type: TestsArtifactDto }) tests?: TestsArtifactDto;
  @ApiPropertyOptional({ type: DeploymentArtifactDto }) deployment?: DeploymentArtifactDto;
  @ApiPropertyOptional({ type: ChangeSetArtifactDto }) changeSet?: ChangeSetArtifactDto;
}
