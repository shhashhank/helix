import { Body, Controller, Get, HttpCode, HttpStatus, MessageEvent, Param, Post, Sse } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { WorkflowDefinition } from '@helix/workflow';
import { RunStatusDto, RetryRunDto, StartRunDto, StartedRunDto } from './dto/workflow-run.dto';
import { WorkflowRunService } from './workflow-run.service';

@ApiTags('workflow-runs')
@Controller('runs')
export class WorkflowRunController {
  constructor(private readonly service: WorkflowRunService) {}

  @Post()
  @ApiOperation({ summary: 'Start a workflow run' })
  @ApiCreatedResponse({ type: StartedRunDto })
  start(@Body() body: StartRunDto): Promise<StartedRunDto> {
    return this.service.start(body.workflow as unknown as WorkflowDefinition, body.workflowId);
  }

  @Get(':id')
  @ApiOperation({ summary: "Get a run's lifecycle status" })
  @ApiOkResponse({ type: RunStatusDto })
  get(@Param('id') id: string): Promise<RunStatusDto> {
    return this.service.get(id);
  }

  @Sse(':id/stream')
  @ApiOperation({ summary: 'Live per-step status stream (Server-Sent Events)' })
  stream(@Param('id') id: string): Observable<MessageEvent> {
    return this.service.streamProgress(id).pipe(map((progress): MessageEvent => ({ data: progress })));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request cancellation of a run' })
  async cancel(@Param('id') id: string): Promise<void> {
    await this.service.cancel(id);
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed run under the same id' })
  @ApiCreatedResponse({ type: StartedRunDto })
  retry(@Param('id') id: string, @Body() body: RetryRunDto): Promise<StartedRunDto> {
    return this.service.retry(id, body.workflow as unknown as WorkflowDefinition);
  }
}
