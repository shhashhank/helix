import type { ApprovalRequest } from '@helix/approvals';

/** DI token for the {@link ApprovalRequestStore}. */
export const APPROVAL_REQUEST_STORE = Symbol('APPROVAL_REQUEST_STORE');

export interface ListApprovalsFilter {
  /** Restrict to requests gating this workflow run. */
  workflowId?: string;
  /** Restrict to a single lifecycle status (e.g. `pending`). */
  status?: ApprovalRequest['status'];
}

/**
 * Where approval requests live between creation and decision. The orchestrator is
 * otherwise stateless (the *durable* state is the paused Temporal run), so this is a
 * deliberately small seam: the in-memory implementation below is fine for a single
 * process, and a durable (DB) store can drop in later — see DEFERRED.md.
 */
export interface ApprovalRequestStore {
  get(id: string): Promise<ApprovalRequest | undefined>;
  put(request: ApprovalRequest): Promise<void>;
  list(filter?: ListApprovalsFilter): Promise<ApprovalRequest[]>;
}

/** Process-local store. Lost on restart — acceptable until the durable store lands. */
export class InMemoryApprovalRequestStore implements ApprovalRequestStore {
  private readonly byId = new Map<string, ApprovalRequest>();

  async get(id: string): Promise<ApprovalRequest | undefined> {
    return this.byId.get(id);
  }

  async put(request: ApprovalRequest): Promise<void> {
    this.byId.set(request.id, request);
  }

  async list(filter: ListApprovalsFilter = {}): Promise<ApprovalRequest[]> {
    return [...this.byId.values()].filter(
      (r) =>
        (filter.workflowId === undefined || r.subjectId === filter.workflowId) &&
        (filter.status === undefined || r.status === filter.status),
    );
  }
}
