/**
 * Merge gate (HELIX-116): turn the review findings into a pass/fail **status
 * check** that blocks or allows the merge, per a configurable policy.
 *
 * The policy is a **severity threshold** — findings at or above it block (default
 * `major`, which catches the secret-scan blockers from HELIX-114). The decision
 * is deterministic; publishing the status check to the PR goes through an
 * injected {@link StatusCheckPublisher} seam (the live impl uses the GitHub
 * tools / deferred Octokit binding).
 */
import { Finding, ReviewSeverity } from './findings';

export interface ReviewPolicy {
  /** Findings at or above this severity fail the gate (default `major`). */
  blockThreshold: ReviewSeverity;
}

export const DEFAULT_REVIEW_POLICY: ReviewPolicy = { blockThreshold: 'major' };

export type MergeGateState = 'pass' | 'fail';

export interface MergeGateDecision {
  state: MergeGateState;
  /** True when the gate fails (merge blocked). */
  blocked: boolean;
  /** The findings at/above the threshold that caused a fail. */
  blockingFindings: Finding[];
  reason: string;
  policy: ReviewPolicy;
}

const SEVERITY_RANK: Record<ReviewSeverity, number> = { info: 0, minor: 1, major: 2, blocker: 3 };

/** Evaluate the merge gate: fail if any finding is at/above the policy threshold. */
export function evaluateMergeGate(
  findings: Finding[],
  policy: ReviewPolicy = DEFAULT_REVIEW_POLICY,
): MergeGateDecision {
  const threshold = SEVERITY_RANK[policy.blockThreshold];
  const blockingFindings = findings.filter((f) => SEVERITY_RANK[f.severity] >= threshold);
  const blocked = blockingFindings.length > 0;

  const reason = blocked
    ? `${blockingFindings.length} finding(s) at or above "${policy.blockThreshold}" block the merge`
    : findings.length === 0
      ? 'No findings.'
      : `${findings.length} non-blocking finding(s); none reach "${policy.blockThreshold}"`;

  return {
    state: blocked ? 'fail' : 'pass',
    blocked,
    blockingFindings,
    reason,
    policy,
  };
}

/** The commit status check name. */
export const MERGE_GATE_CONTEXT = 'helix/code-review';

export interface StatusCheck {
  state: MergeGateState;
  context: string;
  /** Short human description (≤ 140 chars, per GitHub status limits). */
  description: string;
}

/** Publishes a commit status check to the PR (real impl: GitHub tools). */
export interface StatusCheckPublisher {
  publish(check: StatusCheck): Promise<void>;
}

export interface PublishMergeGateOptions {
  /** Status check context/name (default {@link MERGE_GATE_CONTEXT}). */
  context?: string;
}

/** Map a gate decision to a status check payload. */
export function toStatusCheck(
  decision: MergeGateDecision,
  context: string = MERGE_GATE_CONTEXT,
): StatusCheck {
  return { state: decision.state, context, description: truncate(decision.reason, 140) };
}

/** Build the status check and publish it; returns what was published. */
export async function publishMergeGate(
  publisher: StatusCheckPublisher,
  decision: MergeGateDecision,
  options: PublishMergeGateOptions = {},
): Promise<StatusCheck> {
  const check = toStatusCheck(decision, options.context);
  await publisher.publish(check);
  return check;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
