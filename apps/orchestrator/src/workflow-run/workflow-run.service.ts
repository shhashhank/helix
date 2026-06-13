import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SpanStatusCode, type Tracer, trace } from '@opentelemetry/api';
import { Client } from '@temporalio/client';
import { Observable, from, interval } from 'rxjs';
import { concatMap, distinctUntilChanged, startWith, takeWhile } from 'rxjs/operators';
import { type RunCorrelation, contextWithCorrelation, runCorrelation } from '@helix/telemetry';
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
  /** W3C trace id for correlating this run's telemetry (paste into Grafana/Tempo). */
  traceId: string;
  /** The run's `traceparent` header value — hand to the next hop / return to the caller. */
  traceparent: string;
}

/** The run's trace context, attached to the Temporal run so a run id maps back to its trace. */
function memoFor(corr: RunCorrelation): Record<string, unknown> {
  return { traceId: corr.traceId, traceparent: corr.traceparent, spanId: corr.spanId };
}

/**
 * Run lifecycle (HELIX-78): a thin adapter from the HTTP layer to the Temporal
 * client helpers — start / get / cancel / retry — validating the workflow DSL
 * before dispatching it.
 */
@Injectable()
export class WorkflowRunService {
  /** Resolves to the globally-registered provider (HELIX-137) at request time. */
  private readonly tracer: Tracer = trace.getTracer('orchestrator');

  constructor(@Inject(TEMPORAL_CLIENT) private readonly client: Client) {}

  async start(def: WorkflowDefinition, workflowId?: string, correlation?: RunCorrelation): Promise<StartedRun> {
    this.validate(def);
    const corr = correlation ?? runCorrelation();
    const id = workflowId ?? `run-${randomUUID()}`;
    return this.traced('orchestrator.start-run', corr, async () => {
      const handle = await startWorkflowRun(this.client, def, { workflowId: id, memo: memoFor(corr) });
      return started(handle, corr);
    });
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

  async retry(workflowId: string, def: WorkflowDefinition, correlation?: RunCorrelation): Promise<StartedRun> {
    this.validate(def);
    const corr = correlation ?? runCorrelation();
    return this.traced('orchestrator.retry-run', corr, async () => {
      const handle = await retryWorkflowRun(this.client, def, { workflowId, memo: memoFor(corr) });
      return started(handle, corr);
    });
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

  /**
   * Run `fn` inside a span on the run's trace (HELIX-139): the span carries the
   * correlation's trace id as its (remote) parent, so the orchestrator's own work
   * shows up in Tempo under the same trace the caller gets back — and, once the
   * agent executor is wired, its per-run spans join the same trace via the memo.
   */
  private async traced<T>(name: string, corr: RunCorrelation, fn: () => Promise<T>): Promise<T> {
    const span = this.tracer.startSpan(
      name,
      { attributes: { 'helix.run.traceparent': corr.traceparent } },
      contextWithCorrelation(corr),
    );
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      span.end();
    }
  }
}

/** Assemble the {@link StartedRun} payload from a fresh run handle + its correlation. */
function started(
  handle: { workflowId: string; firstExecutionRunId: string },
  corr: RunCorrelation,
): StartedRun {
  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
    traceId: corr.traceId,
    traceparent: corr.traceparent,
  };
}
