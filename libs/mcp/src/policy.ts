/**
 * Tool permissioning — policy model + evaluator (HELIX-83). Decides whether a
 * given caller (org / agent role) may invoke a given MCP tool (server + tool
 * name), returning `allow`, `deny`, or `require_approval`. A basic RBAC/ABAC model:
 * ordered rules match on attributes (omitted attribute = wildcard), and effects
 * combine with a **secure precedence — deny beats require_approval beats allow**,
 * falling back to a configurable default (deny by default).
 *
 * `require_approval` is how high-risk tools route through the Approval Service
 * (HELIX-85); rate limits/quotas layer on top (HELIX-84).
 */

export type PolicyEffect = 'allow' | 'deny' | 'require_approval';

/** Who is asking to call which tool. */
export interface ToolRequest {
  orgId?: string;
  /** Calling agent's role, e.g. `coding`, `planning`. */
  agentRole?: string;
  /** MCP server the tool belongs to. */
  serverId: string;
  toolName: string;
}

/** A single policy rule. Any omitted match field is a wildcard (matches anything). */
export interface PolicyRule {
  id?: string;
  effect: PolicyEffect;
  orgId?: string;
  agentRole?: string;
  serverId?: string;
  /** Exact tool name, `*` (any), or a `prefix*` glob. */
  toolName?: string;
}

export interface ToolPolicy {
  /** Effect when no rule matches. Defaults to `deny` (fail-closed). */
  defaultEffect?: PolicyEffect;
  rules: PolicyRule[];
}

export interface PolicyDecision {
  effect: PolicyEffect;
  /** The rule that decided, or undefined when the default applied. */
  matchedRule?: PolicyRule;
  reason: string;
}

function toolNameMatches(pattern: string | undefined, name: string): boolean {
  if (pattern === undefined || pattern === '*') return true;
  if (pattern.endsWith('*')) return name.startsWith(pattern.slice(0, -1));
  return pattern === name;
}

function ruleMatches(rule: PolicyRule, req: ToolRequest): boolean {
  if (rule.orgId !== undefined && rule.orgId !== req.orgId) return false;
  if (rule.agentRole !== undefined && rule.agentRole !== req.agentRole) return false;
  if (rule.serverId !== undefined && rule.serverId !== req.serverId) return false;
  return toolNameMatches(rule.toolName, req.toolName);
}

/**
 * Evaluate a policy for a tool request. Among the rules that match, the most
 * restrictive effect wins (deny > require_approval > allow); if none match, the
 * policy's `defaultEffect` (default `deny`) applies.
 */
export function evaluatePolicy(policy: ToolPolicy, req: ToolRequest): PolicyDecision {
  const matched = policy.rules.filter((r) => ruleMatches(r, req));

  for (const effect of ['deny', 'require_approval', 'allow'] as const) {
    const rule = matched.find((r) => r.effect === effect);
    if (rule) {
      return { effect, matchedRule: rule, reason: `matched ${effect} rule${rule.id ? ` "${rule.id}"` : ''}` };
    }
  }

  const fallback = policy.defaultEffect ?? 'deny';
  return { effect: fallback, reason: `no matching rule — default ${fallback}` };
}

/** An audited policy decision. */
export interface ToolPolicyAuditEvent {
  request: ToolRequest;
  decision: PolicyDecision;
  /** ISO-8601 time of the decision. */
  at: string;
}

/** Receives every policy decision (denies and allows alike) for the audit trail. */
export interface ToolPolicyAuditSink {
  record(event: ToolPolicyAuditEvent): void | Promise<void>;
}

/** Process-local audit sink. Swap for a durable one (DB) in production. */
export class InMemoryToolPolicyAuditSink implements ToolPolicyAuditSink {
  readonly events: ToolPolicyAuditEvent[] = [];
  record(event: ToolPolicyAuditEvent): void {
    this.events.push(event);
  }
}

/** Thrown by {@link ToolPolicyEnforcer.enforce} when a tool call is denied. */
export class ToolAccessDeniedError extends Error {
  constructor(
    public readonly request: ToolRequest,
    public readonly decision: PolicyDecision,
  ) {
    super(`tool "${request.serverId}:${request.toolName}" denied: ${decision.reason}`);
    this.name = 'ToolAccessDeniedError';
  }
}

/**
 * Evaluates + audits + enforces a {@link ToolPolicy}. `check` returns the audited
 * decision; `enforce` additionally **blocks** a denied call (throws). An
 * `allow`/`require_approval` decision is returned for the caller to act on
 * (proceed, or route to the Approval Service).
 */
export class ToolPolicyEnforcer {
  constructor(
    private readonly policy: ToolPolicy,
    private readonly audit?: ToolPolicyAuditSink,
  ) {}

  async check(req: ToolRequest): Promise<PolicyDecision> {
    const decision = evaluatePolicy(this.policy, req);
    await this.audit?.record({ request: req, decision, at: new Date().toISOString() });
    return decision;
  }

  async enforce(req: ToolRequest): Promise<PolicyDecision> {
    const decision = await this.check(req);
    if (decision.effect === 'deny') throw new ToolAccessDeniedError(req, decision);
    return decision;
  }
}
