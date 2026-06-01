import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Client } from '@temporalio/client';
import { Observable, from, interval } from 'rxjs';
import { concatMap, distinctUntilChanged, startWith, takeWhile } from 'rxjs/operators';
import { WorkflowDefinition, WorkflowProgress, WorkflowValidationFailed, assertValidWorkflow } from '@helix/workflow';
import {
  RunStatus,
  cancelWorkflowRun,
  describeWorkflowRun,
  getWorkflowProgress,
  retryWorkflowRun,
  startWorkflowRun,
} from '@helix/workflow/temporal-client';
import { TEMPORAL_CLIENT } from '../temporal/temporal.constants';

/** How often the live-status stream polls the workflow's progress query. */
const PROGRESS_POLL_MS = 1000;

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

  /**
   * A live stream of a run's per-step progress (HELIX-79): polls the workflow's
   * progress query, emits only when it changes, and completes once the run is done
   * (emitting that final snapshot). The controller exposes this as SSE.
   */
  streamProgress(workflowId: string, pollMs: number = PROGRESS_POLL_MS): Observable<WorkflowProgress> {
    return interval(pollMs).pipe(
      startWith(0), // poll immediately, don't wait one interval
      concatMap(() => from(getWorkflowProgress(this.client, workflowId))),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      takeWhile((p) => !p.done, true), // include the final done snapshot, then complete
    );
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
