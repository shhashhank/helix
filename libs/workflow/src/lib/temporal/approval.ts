/**
 * Human-in-the-loop pause/resume primitive (HELIX-74). A workflow can call
 * {@link awaitApproval} to **durably pause** until a human sends a decision via
 * {@link approvalSignal}, or until a timeout elapses (then a timeout policy
 * decides). The wait is a Temporal `condition`, so it survives worker
 * crashes/restarts — a run can sit waiting for sign-off for hours or days.
 *
 * This module is bundled into the Temporal workflow sandbox: it uses only
 * `@temporalio/workflow` APIs and stays deterministic. The signal *definition*
 * ({@link approvalSignal}) is also safe to import from client/worker code to send
 * the decision (`handle.signal(approvalSignal, …)`).
 */
import { condition, defineQuery, defineSignal, setHandler } from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';

export type ApprovalDecision = 'approved' | 'rejected';

/** Payload a human (via an API) sends to resume a paused workflow. */
export interface ApprovalSignalPayload {
  decision: ApprovalDecision;
  /** Who decided (user id / email), for the audit trail. */
  decidedBy?: string;
  /** Optional free-text reason/comment. */
  reason?: string;
}

/** Resolved outcome of an approval gate. */
export interface ApprovalResult {
  decision: ApprovalDecision;
  /** True when the decision came from the timeout policy rather than a human. */
  timedOut: boolean;
  decidedBy?: string;
  reason?: string;
}

export interface AwaitApprovalOptions {
  /**
   * How long to wait for a human decision before applying the timeout policy
   * (e.g. `'24h'`). Omit to wait indefinitely.
   */
  timeout?: Duration;
  /**
   * Decision to apply if the timeout elapses with no human input. Defaults to
   * `'rejected'` — fail-safe, so a forgotten approval blocks the risky action
   * rather than letting it through.
   */
  onTimeout?: ApprovalDecision;
}

/** Whether the gate is still waiting, or has a decision recorded. */
export type ApprovalState = 'pending' | 'decided';

/** Observable status of an approval gate, readable via {@link approvalStatusQuery}. */
export interface ApprovalStatus {
  state: ApprovalState;
  decision?: ApprovalDecision;
  decidedBy?: string;
  /** True when the recorded decision came from the timeout policy. */
  timedOut?: boolean;
}

/** The signal a paused workflow receives its human decision through. */
export const approvalSignal = defineSignal<[ApprovalSignalPayload]>('approvalDecision');

/** Query a workflow for whether it's awaiting approval (and any recorded decision). */
export const approvalStatusQuery = defineQuery<ApprovalStatus>('approvalStatus');

/**
 * Pause the calling workflow until an {@link approvalSignal} arrives or the
 * optional timeout elapses. Returns the human decision, or — on timeout — the
 * configured `onTimeout` policy (default `'rejected'`). The first signal wins;
 * later signals are ignored.
 */
export async function awaitApproval(opts: AwaitApprovalOptions = {}): Promise<ApprovalResult> {
  let payload: ApprovalSignalPayload | undefined;
  let result: ApprovalResult | undefined;

  setHandler(approvalSignal, (p) => {
    if (payload === undefined) payload = p; // first decision wins
  });
  // Expose status so callers (e.g. a UI) can see a run is awaiting sign-off and,
  // afterwards, what was decided — queryable even on the completed workflow.
  setHandler(approvalStatusQuery, (): ApprovalStatus =>
    result === undefined
      ? { state: 'pending' }
      : {
          state: 'decided',
          decision: result.decision,
          decidedBy: result.decidedBy,
          timedOut: result.timedOut,
        },
  );

  if (opts.timeout === undefined) {
    await condition(() => payload !== undefined);
  } else if (!(await condition(() => payload !== undefined, opts.timeout))) {
    result = { decision: opts.onTimeout ?? 'rejected', timedOut: true };
    return result;
  }

  const decided = payload as ApprovalSignalPayload;
  result = {
    decision: decided.decision,
    timedOut: false,
    decidedBy: decided.decidedBy,
    reason: decided.reason,
  };
  return result;
}
