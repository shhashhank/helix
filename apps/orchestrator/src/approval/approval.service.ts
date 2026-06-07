import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ApprovalRequest,
  ApprovalTransitionError,
  DecisionVote,
  InboxItem,
  ResolvedRequirement,
  buildInbox,
  cancelRequest,
  createApprovalRequest,
  expireIfDue,
  submitDecision,
} from '@helix/approvals';
import {
  APPROVAL_REQUEST_STORE,
  ApprovalRequestStore,
  ListApprovalsFilter,
} from './approval.store';
import { WORKFLOW_SIGNALER, WorkflowSignaler } from './approval.signaler';
import { APPROVAL_NOTIFIER, ApprovalNotifier } from './approval.notifier';

export interface OpenApprovalInput {
  /** The workflow run this gate is attached to; the run resumed on decision. */
  workflowId: string;
  /** The folded policy requirement (who/how-many/SLA), from `evaluatePolicy`. */
  requirement: ResolvedRequirement;
  /** What's being gated, e.g. `deploy prod`. */
  action: string;
  requestedBy?: string;
  reason?: string;
}

export interface DecisionInputDto {
  approver: string;
  role: string;
  vote: DecisionVote;
  comment?: string;
}

/**
 * The decision flow (HELIX-131): the inbound half of human-in-the-loop. Opens an
 * approval request from a policy requirement, records each human decision against
 * the `@helix/approvals` state machine, and — the moment the gate *resolves*
 * (quorum approved, or rejected) — signals the durable Temporal run to resume.
 * While a request is still pending (quorum not met) no signal is sent.
 */
@Injectable()
export class ApprovalService {
  constructor(
    @Inject(APPROVAL_REQUEST_STORE) private readonly store: ApprovalRequestStore,
    @Inject(WORKFLOW_SIGNALER) private readonly signaler: WorkflowSignaler,
    @Inject(APPROVAL_NOTIFIER) private readonly notifier: ApprovalNotifier,
  ) {}

  async open(input: OpenApprovalInput): Promise<ApprovalRequest> {
    const request = createApprovalRequest({
      id: `appr-${randomUUID()}`,
      requirement: input.requirement,
      action: input.action,
      subjectId: input.workflowId,
      requestedBy: input.requestedBy,
      reason: input.reason,
    });
    await this.store.put(request);
    // Notify approvers, best-effort: a notification failure must not block the gate.
    try {
      await this.notifier.notifyRequested(request);
    } catch {
      /* swallow — notifications are non-critical */
    }
    return request;
  }

  async get(id: string): Promise<ApprovalRequest> {
    const request = await this.requireFresh(id);
    return request;
  }

  list(filter?: ListApprovalsFilter): Promise<ApprovalRequest[]> {
    return this.store.list(filter);
  }

  /**
   * The "what's waiting on me" view (HELIX-132): all pending requests (optionally
   * those a given role may approve), each with quorum progress + SLA, most-urgent
   * first. Lazily expires past-SLA requests so the inbox never shows a stale gate.
   */
  async inbox(role?: string): Promise<InboxItem[]> {
    const now = new Date();
    const fresh: ApprovalRequest[] = [];
    for (const request of await this.store.list({ status: 'pending' })) {
      const expired = expireIfDue(request, now);
      if (expired !== request) await this.store.put(expired);
      if (expired.status === 'pending') fresh.push(expired);
    }
    return buildInbox(fresh, { role, now });
  }

  /**
   * Record a human decision. Lazily expires a past-SLA request first, then applies
   * the vote via the state machine; if that resolves the gate, signal the run.
   */
  async decide(id: string, decision: DecisionInputDto): Promise<ApprovalRequest> {
    const current = await this.requireFresh(id);

    let updated: ApprovalRequest;
    try {
      updated = submitDecision(current, decision);
    } catch (err) {
      if (err instanceof ApprovalTransitionError) throw new ConflictException(err.message);
      throw err;
    }
    await this.store.put(updated);

    if (updated.status === 'approved' || updated.status === 'rejected') {
      await this.signaler.signalDecision(updated.subjectId ?? updated.id, {
        decision: updated.status,
        decidedBy: decision.approver,
        reason: decision.comment,
      });
    }
    return updated;
  }

  async cancel(id: string, reason?: string): Promise<ApprovalRequest> {
    const current = await this.requireFresh(id);
    let cancelled: ApprovalRequest;
    try {
      cancelled = cancelRequest(current, { reason });
    } catch (err) {
      if (err instanceof ApprovalTransitionError) throw new ConflictException(err.message);
      throw err;
    }
    await this.store.put(cancelled);
    return cancelled;
  }

  /** Load a request, lazily persisting an SLA expiry, or 404 if it doesn't exist. */
  private async requireFresh(id: string): Promise<ApprovalRequest> {
    const request = await this.store.get(id);
    if (!request) throw new NotFoundException(`approval request ${id} not found`);
    const expired = expireIfDue(request);
    if (expired !== request) await this.store.put(expired);
    return expired;
  }
}
