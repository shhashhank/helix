/** API response shapes the web app consumes (mirrors the orchestrator DTOs). */

/** A recorded build request and the run it started. */
export interface BuildRequest {
  id: string;
  orgId: string | null;
  submittedBy: string;
  title: string;
  prompt: string;
  status: string;
  workflowId: string;
  runId: string;
  traceId: string;
  createdAt: string;
}

/** A run's lifecycle status (RUNNING | COMPLETED | FAILED | …). */
export interface RunStatus {
  workflowId: string;
  runId: string;
  status: string;
  startTime?: string;
  closeTime?: string;
  traceId?: string;
}

/** A run-dashboard row: a request joined with its run's current status. */
export interface DashboardItem {
  request: BuildRequest;
  run: RunStatus;
}

/** One step's outcome within a run's live progress. */
export interface StepOutcome {
  id: string;
  ran: boolean;
  status?: 'success' | 'failure';
  output?: unknown;
  error?: string;
}

/** Live run progress streamed over SSE (the per-step feed). */
export interface WorkflowProgress {
  steps: Record<string, StepOutcome>;
  completed: string[];
  skipped: string[];
  /** Topological levels — the step order to display. */
  levels: string[][];
  done: boolean;
}

/** The outputs a run produced — each present only once its step has run. */
export interface RunArtifacts {
  pullRequest?: { url: string; title?: string };
  tests?: { passed: number; failed: number; coverage?: number };
  deployment?: { url: string; environment?: string };
}
