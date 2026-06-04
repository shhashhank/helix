/**
 * Approval-gated tool routing (HELIX-85). Ties the permission policy (HELIX-83) to
 * a human Approval Service: a tool call the policy marks `require_approval` is
 * routed for sign-off before it may run.
 *
 * The "Approval Service" is an injected {@link ToolApprovalGateway} — in production
 * it publishes an approval request and durably waits for the decision (the
 * Workflow epic's `awaitApproval` / Approval Service); here it stays an interface
 * so this layer is decoupled and testable.
 */
import { PolicyDecision, ToolPolicyEnforcer, ToolRequest } from './policy';

export type ApprovalOutcome = 'approved' | 'rejected';

/** A tool call that needs human sign-off, handed to the Approval Service. */
export interface ToolApprovalRequest {
  request: ToolRequest;
  /** Why approval is needed (the policy reason). */
  reason: string;
  /** Structured context for the approver (e.g. the matched rule). */
  context?: Record<string, unknown>;
}

/** Routes an approval request to a human and resolves with their decision. */
export interface ToolApprovalGateway {
  requestApproval(req: ToolApprovalRequest): Promise<ApprovalOutcome>;
}

/** Thrown when an approval-gated tool call is rejected by the approver. */
export class ToolApprovalRejectedError extends Error {
  constructor(
    public readonly request: ToolRequest,
    public readonly decision: PolicyDecision,
  ) {
    super(`tool "${request.serverId}:${request.toolName}" was rejected by the approver`);
    this.name = 'ToolApprovalRejectedError';
  }
}

/** Outcome of {@link ApprovalGatedToolPolicy.authorize} when the call may proceed. */
export interface ToolAuthorization {
  /** Always true when returned — `deny`/rejection throw instead. */
  allowed: true;
  /** True when the call required and received human approval. */
  viaApproval: boolean;
  decision: PolicyDecision;
}

/**
 * Authorizes tool calls end-to-end: evaluate the policy, **block** denials, let
 * plain allows through, and **route `require_approval` to the Approval Service** —
 * proceeding only if approved, throwing {@link ToolApprovalRejectedError} if not.
 */
export class ApprovalGatedToolPolicy {
  constructor(
    private readonly enforcer: ToolPolicyEnforcer,
    private readonly gateway: ToolApprovalGateway,
  ) {}

  async authorize(req: ToolRequest): Promise<ToolAuthorization> {
    // Throws ToolAccessDeniedError on `deny`; returns `allow` or `require_approval`.
    const decision = await this.enforcer.enforce(req);

    if (decision.effect === 'allow') {
      return { allowed: true, viaApproval: false, decision };
    }

    const outcome = await this.gateway.requestApproval({
      request: req,
      reason: decision.reason,
      context: decision.matchedRule ? { rule: decision.matchedRule } : undefined,
    });

    if (outcome === 'approved') {
      return { allowed: true, viaApproval: true, decision };
    }
    throw new ToolApprovalRejectedError(req, decision);
  }
}
