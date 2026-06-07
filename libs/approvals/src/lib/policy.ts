/**
 * Approval policy model (HELIX-128): the configuration that decides *whether* an
 * action needs human sign-off, *who* may approve it, and the *SLA* for responding.
 *
 * A {@link ApprovalPolicy} is an ordered set of {@link GateRule}s. Each rule has a
 * {@link GateCondition} (matched against a {@link GateContext} describing the action)
 * and an {@link ApprovalRequirement} (approver roles, quorum, SLA, escalation).
 * `evaluatePolicy` finds the matching rules and folds their requirements into one
 * resolved requirement. The schema (zod) doubles as the validator for the policy
 * admin API/UI (HELIX-129). Pure + deterministic; the request/decision flow that
 * consumes a requirement is HELIX-130.
 */
import { z } from 'zod';

/** Coarse risk bands, ordered low → critical. */
export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
const riskLevelSchema = z.enum(RISK_LEVELS);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

const riskOrdinal: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * The matchers for a gate rule. Every present field must match (logical AND); an
 * empty condition (`{}`) matches every action — a catch-all.
 */
export const gateConditionSchema = z
  .object({
    /** Match if the action is one of these (e.g. `deploy`, `merge`). */
    actions: z.array(z.string().min(1)).optional(),
    /** Match if the target environment is one of these (e.g. `prod`). */
    environments: z.array(z.string().min(1)).optional(),
    /** Match if the triggering agent role is one of these. */
    agentRoles: z.array(z.string().min(1)).optional(),
    /** Match if the action's risk is at least this band. */
    riskAtLeast: riskLevelSchema.optional(),
    /** Match if the estimated cost is at least this many USD. */
    minEstimatedCostUsd: z.number().nonnegative().optional(),
    /** Match if the action carries any of these tags. */
    anyTags: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type GateCondition = z.infer<typeof gateConditionSchema>;

/** What sign-off a matched rule demands. */
export const approvalRequirementSchema = z
  .object({
    /** Roles allowed to approve (at least one). */
    approverRoles: z.array(z.string().min(1)).min(1),
    /** How many distinct approvals are needed (quorum); default 1. */
    minApprovals: z.number().int().positive().optional(),
    /** Respond-within window in minutes; omitted = no SLA. */
    slaMinutes: z.number().int().positive().optional(),
    /** Roles to escalate to if the SLA is breached. */
    escalateTo: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type ApprovalRequirement = z.infer<typeof approvalRequirementSchema>;

export const gateRuleSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().optional(),
    when: gateConditionSchema,
    require: approvalRequirementSchema,
    /** Disabled rules never match; default enabled. */
    enabled: z.boolean().optional(),
  })
  .strict();
export type GateRule = z.infer<typeof gateRuleSchema>;

export const approvalPolicySchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    rules: z.array(gateRuleSchema),
  })
  .strict()
  .superRefine((policy, ctx) => {
    const seen = new Set<string>();
    policy.rules.forEach((rule, i) => {
      if (seen.has(rule.id)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate rule id: ${rule.id}`, path: ['rules', i, 'id'] });
      }
      seen.add(rule.id);
    });
  });
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

/** Describes the action being gated; matched against each rule's condition. */
export interface GateContext {
  /** What's happening, e.g. `deploy`, `merge`, `tool-call`. */
  action: string;
  /** Target environment, e.g. `prod` / `staging` / `dev`. */
  environment?: string;
  /** The agent role that triggered the action. */
  agentRole?: string;
  /** Assessed risk of the action. */
  riskLevel?: RiskLevel;
  /** Estimated cost of the action, in USD. */
  estimatedCostUsd?: number;
  /** Free-form labels, e.g. `db-migration`, `secrets`. */
  tags?: string[];
}

/** Does a context satisfy a condition? Every present matcher must pass. */
export function matchesCondition(condition: GateCondition, context: GateContext): boolean {
  if (condition.actions && !condition.actions.includes(context.action)) return false;
  if (condition.environments) {
    if (!context.environment || !condition.environments.includes(context.environment)) return false;
  }
  if (condition.agentRoles) {
    if (!context.agentRole || !condition.agentRoles.includes(context.agentRole)) return false;
  }
  if (condition.riskAtLeast) {
    if (!context.riskLevel) return false;
    if (riskOrdinal[context.riskLevel] < riskOrdinal[condition.riskAtLeast]) return false;
  }
  if (condition.minEstimatedCostUsd !== undefined) {
    if (context.estimatedCostUsd === undefined || context.estimatedCostUsd < condition.minEstimatedCostUsd) {
      return false;
    }
  }
  if (condition.anyTags) {
    const tags = context.tags ?? [];
    if (!condition.anyTags.some((t) => tags.includes(t))) return false;
  }
  return true;
}

/** The requirement that actually applies, after folding all matched rules together. */
export interface ResolvedRequirement {
  /** Union of all matched rules' approver roles. */
  approverRoles: string[];
  /** The strictest quorum across matched rules (max), at least 1. */
  minApprovals: number;
  /** The tightest SLA across matched rules (min), if any rule set one. */
  slaMinutes?: number;
  /** Union of all matched rules' escalation roles. */
  escalateTo: string[];
}

export interface PolicyEvaluation {
  /** True if at least one enabled rule matched. */
  requiresApproval: boolean;
  /** The ids of the rules that matched, in policy order. */
  matchedRuleIds: string[];
  /** The folded requirement; present iff `requiresApproval`. */
  requirement?: ResolvedRequirement;
}

/**
 * Evaluate a policy against an action. Matching rules' requirements are folded:
 * approver roles and escalation targets are unioned, the quorum takes the max
 * (strictest), and the SLA takes the min (tightest). No match → no approval needed.
 */
export function evaluatePolicy(policy: ApprovalPolicy, context: GateContext): PolicyEvaluation {
  const matched = policy.rules.filter((r) => r.enabled !== false && matchesCondition(r.when, context));
  if (matched.length === 0) {
    return { requiresApproval: false, matchedRuleIds: [] };
  }

  const approverRoles = new Set<string>();
  const escalateTo = new Set<string>();
  let minApprovals = 1;
  let slaMinutes: number | undefined;

  for (const rule of matched) {
    for (const role of rule.require.approverRoles) approverRoles.add(role);
    for (const role of rule.require.escalateTo ?? []) escalateTo.add(role);
    minApprovals = Math.max(minApprovals, rule.require.minApprovals ?? 1);
    if (rule.require.slaMinutes !== undefined) {
      slaMinutes = slaMinutes === undefined ? rule.require.slaMinutes : Math.min(slaMinutes, rule.require.slaMinutes);
    }
  }

  return {
    requiresApproval: true,
    matchedRuleIds: matched.map((r) => r.id),
    requirement: {
      approverRoles: [...approverRoles],
      minApprovals,
      ...(slaMinutes !== undefined ? { slaMinutes } : {}),
      escalateTo: [...escalateTo],
    },
  };
}

/** Validate + parse an untrusted policy object (throws on invalid). For the admin API (HELIX-129). */
export function parseApprovalPolicy(input: unknown): ApprovalPolicy {
  return approvalPolicySchema.parse(input);
}

/** Non-throwing variant returning zod's `SafeParseReturnType`. */
export function safeParseApprovalPolicy(input: unknown) {
  return approvalPolicySchema.safeParse(input);
}

/**
 * A conservative starter policy: human sign-off for any production deploy and for
 * any high-or-worse risk action. Useful as a default and for the admin UI seed.
 */
export function defaultApprovalPolicy(): ApprovalPolicy {
  return {
    id: 'default',
    version: 1,
    rules: [
      {
        id: 'prod-deploy',
        description: 'Production deploys require a tech lead sign-off within 1h.',
        when: { actions: ['deploy'], environments: ['prod', 'production'] },
        require: { approverRoles: ['tech-lead'], minApprovals: 1, slaMinutes: 60, escalateTo: ['eng-manager'] },
      },
      {
        id: 'high-risk',
        description: 'High or critical risk actions require a tech lead + security sign-off.',
        when: { riskAtLeast: 'high' },
        require: { approverRoles: ['tech-lead', 'security'], minApprovals: 2, slaMinutes: 120 },
      },
    ],
  };
}
