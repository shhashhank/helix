import type { OrgId } from '@helix/tenancy';

/**
 * A user-submitted **build request** (HELIX-145): "here's what I want built." The
 * orchestrator turns it into a workflow run and tracks the link, so the run
 * dashboard (HELIX-146) can list a user's requests and follow their runs. The
 * rendered submission form is deferred (API-first — see DEFERRED.md).
 */
export interface BuildRequest {
  /** `req-<uuid>`. */
  id: string;
  /** Owning org/tenant (from the authenticated principal). */
  orgId: OrgId;
  /** User id that submitted it (the principal's `sub`). */
  submittedBy: string;
  /** Short human title. */
  title: string;
  /** What to build, in the user's words — recorded for the (deferred) planning-driven DAG. */
  prompt: string;
  /** Lifecycle of the *submission* (the run's own status lives in Temporal). */
  status: BuildRequestStatus;
  /** The workflow run started for this request. */
  workflowId: string;
  runId: string;
  /** W3C trace id correlating the request with its run's telemetry (HELIX-139). */
  traceId: string;
  /** ISO 8601 submission time. */
  createdAt: string;
}

export type BuildRequestStatus = 'submitted';
