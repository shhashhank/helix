/**
 * Approval request model + sink (HELIX-75). When a workflow pauses for human
 * sign-off ([[awaitApproval]], HELIX-74), it first **publishes an approval
 * request** so a person/UI/approval-service knows a decision is needed. This file
 * is the dependency-light model + the pluggable sink (the "Approval service"
 * abstraction); the actual publish happens in a Temporal activity (see
 * {@link import('./temporal/approval-activities')}).
 */

/** A request for a human to approve/reject a paused workflow's risky action. */
export interface ApprovalRequest {
  /** Stable id for this request — the approval service should dedupe on it. */
  id: string;
  /** The workflow run this approval gates. */
  workflowId: string;
  /** Optional id of the gate/step within the workflow. */
  gateId?: string;
  /** Human-readable description of what needs sign-off. */
  summary: string;
  /** Arbitrary structured context for the approver (diff, cost, target, …). */
  context?: Record<string, unknown>;
  /** When the request was created (ISO-8601). Stamped by the emitter if unset. */
  requestedAt?: string;
}

/** Publishes approval requests to wherever approvers see them (queue, DB, webhook…). */
export interface ApprovalRequestSink {
  publish(request: ApprovalRequest): Promise<void>;
}

/** Process-local sink that just records published requests. Swap for a real service. */
export class InMemoryApprovalRequestSink implements ApprovalRequestSink {
  readonly published: ApprovalRequest[] = [];

  async publish(request: ApprovalRequest): Promise<void> {
    this.published.push(request);
  }
}
