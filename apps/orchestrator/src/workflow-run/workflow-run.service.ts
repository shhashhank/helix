import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Client } from '@temporalio/client';
import { WorkflowDefinition, WorkflowValidationFailed, assertValidWorkflow } from '@helix/workflow';
import {
  RunStatus,
  cancelWorkflowRun,
  describeWorkflowRun,
  retryWorkflowRun,
  startWorkflowRun,
} from '@helix/workflow/temporal-client';
import { TEMPORAL_CLIENT } from '../temporal/temporal.constants';

export interface StartedRun {
  workflowId: string;
  runId: string;
}

/**
 * Run lifecycle (HELIX-78): a thin adapter from the HTTP layer to the Temporal
 * client helpers — start / get / cancel / retry — validating the workflow DSL
 * before dispatching it.
 */
@Injectable()
export class WorkflowRunService {
  constructor(@Inject(TEMPORAL_CLIENT) private readonly client: Client) {}

  async start(def: WorkflowDefinition, workflowId?: string): Promise<StartedRun> {
    this.validate(def);
    const id = workflowId ?? `run-${randomUUID()}`;
    const handle = await startWorkflowRun(this.client, def, { workflowId: id });
    return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
  }

  get(workflowId: string): Promise<RunStatus> {
    return describeWorkflowRun(this.client, workflowId);
  }

  cancel(workflowId: string): Promise<void> {
    return cancelWorkflowRun(this.client, workflowId);
  }

  async retry(workflowId: string, def: WorkflowDefinition): Promise<StartedRun> {
    this.validate(def);
    const handle = await retryWorkflowRun(this.client, def, { workflowId });
    return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
  }

  /** Reject a malformed workflow at the API boundary (400 rather than a runtime failure). */
  private validate(def: WorkflowDefinition): void {
    try {
      assertValidWorkflow(def);
    } catch (err) {
      if (err instanceof WorkflowValidationFailed) throw new BadRequestException(err.message);
      throw err;
    }
  }
}
