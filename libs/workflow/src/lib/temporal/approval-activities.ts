/**
 * Approval-request emit activity (HELIX-75). Publishing an approval request is a
 * *side effect* (it hits an external service), so it runs as a Temporal
 * **activity** — durable and retryable — driven by an injected
 * {@link ApprovalRequestSink}. The workflow calls this before pausing on
 * {@link import('./approval').awaitApproval}.
 */
import { ApprovalRequest, ApprovalRequestSink } from '../approval-request';

/** The approval activities a worker hosts. */
export interface ApprovalActivities {
  emitApprovalRequest(request: ApprovalRequest): Promise<void>;
}

/**
 * Build the approval activities from an injected sink. Stamps `requestedAt` if
 * the caller didn't. Retries publish a request with the same `id`, so the sink/
 * approval service should dedupe on it.
 */
export function createApprovalActivities(sink: ApprovalRequestSink): ApprovalActivities {
  return {
    async emitApprovalRequest(request: ApprovalRequest): Promise<void> {
      await sink.publish({
        ...request,
        requestedAt: request.requestedAt ?? new Date().toISOString(),
      });
    },
  };
}
