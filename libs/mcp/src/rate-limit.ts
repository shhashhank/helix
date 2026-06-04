/**
 * Tool rate limiting + quotas (HELIX-84). Caps how often a tool can be called,
 * scoped per org / server / tool, on top of the permission policy (HELIX-83).
 *
 * Uses a fixed-window counter (injectable clock, so it's deterministic to test).
 * The bucket granularity follows each rule's scope: a rule scoped to `orgId` caps
 * an org's *total* tool calls; one scoped to `toolName` caps per tool; etc. The
 * default in-memory store is process-local — swap for a shared store (Redis) to
 * enforce quotas across replicas.
 */
import { ToolRequest } from './policy';

export interface RateLimit {
  /** Max calls allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Calls remaining in the current window (0 when blocked). */
  remaining: number;
  limit: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
}

/** Fixed-window rate limiter keyed by an arbitrary string. */
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { count: number; windowStart: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Record an attempt against `key` and report whether it's within `limit`. */
  check(key: string, limit: RateLimit): RateLimitResult {
    const t = this.now();
    const bucket = this.buckets.get(key);

    if (!bucket || t - bucket.windowStart >= limit.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: t });
      return { allowed: true, remaining: limit.limit - 1, limit: limit.limit, resetAt: t + limit.windowMs };
    }

    const resetAt = bucket.windowStart + limit.windowMs;
    if (bucket.count >= limit.limit) {
      return { allowed: false, remaining: 0, limit: limit.limit, resetAt };
    }
    bucket.count += 1;
    return { allowed: true, remaining: limit.limit - bucket.count, limit: limit.limit, resetAt };
  }
}

/** A quota rule: which calls it applies to (omitted field = wildcard) + the limit. */
export interface QuotaRule extends RateLimit {
  id?: string;
  orgId?: string;
  agentRole?: string;
  serverId?: string;
  /** Exact tool name, `*` (any), or a `prefix*` glob — for matching only. */
  toolName?: string;
}

export interface QuotaPolicy {
  /** Evaluated in order; the first matching rule applies. No match = unlimited. */
  rules: QuotaRule[];
}

function toolNameMatches(pattern: string | undefined, name: string): boolean {
  if (pattern === undefined || pattern === '*') return true;
  if (pattern.endsWith('*')) return name.startsWith(pattern.slice(0, -1));
  return pattern === name;
}

function ruleMatches(rule: QuotaRule, req: ToolRequest): boolean {
  if (rule.orgId !== undefined && rule.orgId !== req.orgId) return false;
  if (rule.agentRole !== undefined && rule.agentRole !== req.agentRole) return false;
  if (rule.serverId !== undefined && rule.serverId !== req.serverId) return false;
  return toolNameMatches(rule.toolName, req.toolName);
}

/** Bucket key from the request values for the fields the rule scopes on. */
function quotaKey(rule: QuotaRule, req: ToolRequest): string {
  const parts: string[] = [];
  if (rule.orgId !== undefined) parts.push(`org=${req.orgId ?? ''}`);
  if (rule.agentRole !== undefined) parts.push(`role=${req.agentRole ?? ''}`);
  if (rule.serverId !== undefined) parts.push(`srv=${req.serverId}`);
  if (rule.toolName !== undefined) parts.push(`tool=${req.toolName}`);
  return `${rule.id ?? 'rule'}#${parts.join('|') || 'global'}`;
}

export interface QuotaDecision {
  allowed: boolean;
  /** The rule that applied, or undefined when no rule matched (unlimited). */
  rule?: QuotaRule;
  result?: RateLimitResult;
}

/** Thrown by {@link ToolQuotaEnforcer.enforce} when a quota is exceeded. */
export class RateLimitExceededError extends Error {
  constructor(
    public readonly request: ToolRequest,
    public readonly decision: QuotaDecision,
  ) {
    const r = decision.result;
    super(
      `rate limit exceeded for "${request.serverId}:${request.toolName}"` +
        (r ? ` (limit ${r.limit}; resets at ${new Date(r.resetAt).toISOString()})` : ''),
    );
    this.name = 'RateLimitExceededError';
  }
}

/** Applies a {@link QuotaPolicy} to tool requests using a {@link FixedWindowRateLimiter}. */
export class ToolQuotaEnforcer {
  constructor(
    private readonly policy: QuotaPolicy,
    private readonly limiter: FixedWindowRateLimiter = new FixedWindowRateLimiter(),
  ) {}

  /** Count this request and report whether it's within quota. */
  check(req: ToolRequest): QuotaDecision {
    const rule = this.policy.rules.find((r) => ruleMatches(r, req));
    if (!rule) return { allowed: true };
    const result = this.limiter.check(quotaKey(rule, req), { limit: rule.limit, windowMs: rule.windowMs });
    return { allowed: result.allowed, rule, result };
  }

  /** Like {@link check}, but throws {@link RateLimitExceededError} when over quota. */
  enforce(req: ToolRequest): QuotaDecision {
    const decision = this.check(req);
    if (!decision.allowed) throw new RateLimitExceededError(req, decision);
    return decision;
  }
}
