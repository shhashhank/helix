import { Effort, LlmCompletionRequest, ModelTier } from './types';

/**
 * Routing policy engine (HELIX-55): maps a *task class* to a model tier plus
 * model-policy knobs (effort, max tokens) and a per-call cost ceiling. This is
 * where "use Opus for planning, Haiku for classification" lives, kept separate
 * from any provider so the same policy drives every backend.
 *
 * Task classes are open strings; well-known ones are in {@link TaskClass}. An
 * unknown class falls back to the `default` policy entry.
 */
export type TaskClass =
  | 'planning'
  | 'coding'
  | 'code_review'
  | 'testing'
  | 'classification'
  | 'summarization'
  | 'default'
  | (string & {});

export interface RoutePolicyEntry {
  tier: ModelTier;
  effort?: Effort;
  maxTokens?: number;
  /** Max USD per call; `undefined` means no ceiling. Enforced via pricing.ts. */
  costCeilingUsd?: number;
}

/** A policy table. Must include a `default` entry used for unknown task classes. */
export type RoutePolicy = Record<string, RoutePolicyEntry> & { default: RoutePolicyEntry };

/**
 * Default policy: heavier reasoning on Opus for plan/code/review, mid-tier
 * Sonnet for tests and the catch-all, cheap Haiku for classification and
 * summarization. Effort is only set on tiers that accept it (never Haiku).
 */
export const DEFAULT_ROUTE_POLICY: RoutePolicy = {
  planning: { tier: 'opus', effort: 'high', costCeilingUsd: 1.0 },
  coding: { tier: 'opus', effort: 'xhigh', costCeilingUsd: 2.0 },
  code_review: { tier: 'opus', effort: 'high', costCeilingUsd: 1.0 },
  testing: { tier: 'sonnet', effort: 'medium', costCeilingUsd: 0.5 },
  classification: { tier: 'haiku', costCeilingUsd: 0.05 },
  summarization: { tier: 'haiku', costCeilingUsd: 0.1 },
  default: { tier: 'sonnet', effort: 'medium', costCeilingUsd: 0.5 },
};

/** Effort is unsupported on Haiku; the router drops it for that tier. */
const TIER_SUPPORTS_EFFORT: Record<ModelTier, boolean> = {
  opus: true,
  sonnet: true,
  haiku: false,
};

export interface RouteDecision {
  taskClass: string;
  tier: ModelTier;
  effort?: Effort;
  maxTokens?: number;
  costCeilingUsd?: number;
}

export class ModelRouter {
  constructor(private readonly policy: RoutePolicy = DEFAULT_ROUTE_POLICY) {}

  /**
   * Resolve a task class to a {@link RouteDecision}. Unknown classes use the
   * `default` entry. `overrides` win over the policy (e.g. force a tier or
   * tighten the ceiling for one call). Effort is dropped if the resolved tier
   * doesn't support it.
   */
  route(taskClass: TaskClass, overrides: Partial<RoutePolicyEntry> = {}): RouteDecision {
    const entry = this.policy[taskClass] ?? this.policy.default;
    const merged: RoutePolicyEntry = { ...entry, ...overrides };
    const effort = TIER_SUPPORTS_EFFORT[merged.tier] ? merged.effort : undefined;
    return {
      taskClass,
      tier: merged.tier,
      effort,
      maxTokens: merged.maxTokens,
      costCeilingUsd: merged.costCeilingUsd,
    };
  }
}

/**
 * Apply a route decision to a completion request, setting `tier`, `effort`, and
 * `maxTokens`. Explicit fields already on `request` are preserved (the caller's
 * intent wins). Returns a new request; the cost ceiling is carried separately
 * on the decision and enforced after the call via pricing.ts.
 */
export function applyRouteToRequest(
  decision: RouteDecision,
  request: LlmCompletionRequest,
): LlmCompletionRequest {
  return {
    ...request,
    tier: request.tier ?? decision.tier,
    effort: request.effort ?? decision.effort,
    maxTokens: request.maxTokens ?? decision.maxTokens,
  };
}
