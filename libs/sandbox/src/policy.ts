/**
 * Sandbox egress controls + resource limits (HELIX-102): the safety fence the
 * coding agent's workspace runs behind.
 *
 * The **policy** is data — a network allowlist plus CPU/memory/disk/time/process
 * caps — that the real container/microVM backend enforces at the OS level (that
 * enforcement is the deferred binding). What's enforceable and testable *here*,
 * in-process, is the **egress decision** (does the policy allow a given host?)
 * and the **wall-clock limit** (cap how long an in-process operation may run).
 * Egress uses the same `deny > allow > default`, default-deny precedence as the
 * MCP tool policy, so the sandbox can't reach the network unless explicitly let.
 */

/** OS-level resource caps the backend applies to the sandbox. */
export interface ResourceLimits {
  /** Max CPU cores. */
  cpus: number;
  /** Max memory, MB. */
  memoryMb: number;
  /** Max scratch disk, MB. */
  diskMb: number;
  /** Max wall-clock run time, ms. */
  wallClockMs: number;
  /** Max concurrent processes. */
  maxProcesses: number;
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  cpus: 2,
  memoryMb: 2048,
  diskMb: 4096,
  wallClockMs: 10 * 60_000,
  maxProcesses: 256,
};

export type EgressAction = 'allow' | 'deny';

/** Network egress rules. Default-deny: nothing is reachable unless allow-listed. */
export interface EgressPolicy {
  /** Action when no rule matches. Secure default: `deny`. */
  defaultAction: EgressAction;
  /** Host patterns explicitly allowed — exact (`api.github.com`) or `*.suffix`. */
  allow: string[];
  /** Host patterns explicitly denied — wins over `allow`. */
  deny: string[];
}

export const DEFAULT_EGRESS_POLICY: EgressPolicy = {
  defaultAction: 'deny',
  // Just enough for a typical install/build: the npm registry + GitHub.
  allow: ['registry.npmjs.org', 'github.com', 'api.github.com', 'codeload.github.com'],
  deny: [],
};

export interface SandboxPolicy {
  resources: ResourceLimits;
  egress: EgressPolicy;
}

/** A fresh copy of the secure default policy. */
export function defaultSandboxPolicy(): SandboxPolicy {
  return {
    resources: { ...DEFAULT_RESOURCE_LIMITS },
    egress: {
      defaultAction: DEFAULT_EGRESS_POLICY.defaultAction,
      allow: [...DEFAULT_EGRESS_POLICY.allow],
      deny: [...DEFAULT_EGRESS_POLICY.deny],
    },
  };
}

export interface SandboxPolicyInput {
  resources?: Partial<ResourceLimits>;
  egress?: Partial<EgressPolicy>;
}

export class SandboxPolicyError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid sandbox policy: ${issues.join('; ')}`);
    this.name = 'SandboxPolicyError';
  }
}

/** Merge a partial policy over the secure defaults and validate it. */
export function resolveSandboxPolicy(input: SandboxPolicyInput = {}): SandboxPolicy {
  const resources: ResourceLimits = { ...DEFAULT_RESOURCE_LIMITS, ...input.resources };
  const egress: EgressPolicy = {
    defaultAction: input.egress?.defaultAction ?? DEFAULT_EGRESS_POLICY.defaultAction,
    allow: input.egress?.allow ?? [...DEFAULT_EGRESS_POLICY.allow],
    deny: input.egress?.deny ?? [...DEFAULT_EGRESS_POLICY.deny],
  };

  const issues: string[] = [];
  const positive = (name: keyof ResourceLimits) => {
    if (!(resources[name] > 0)) issues.push(`resources.${name} must be > 0`);
  };
  positive('cpus');
  positive('memoryMb');
  positive('diskMb');
  positive('wallClockMs');
  positive('maxProcesses');
  if (!Number.isInteger(resources.maxProcesses)) issues.push('resources.maxProcesses must be an integer');
  if (egress.defaultAction !== 'allow' && egress.defaultAction !== 'deny') {
    issues.push("egress.defaultAction must be 'allow' or 'deny'");
  }
  for (const list of ['allow', 'deny'] as const) {
    if (egress[list].some((h) => !h || !h.trim())) issues.push(`egress.${list} contains an empty host`);
  }
  if (issues.length > 0) throw new SandboxPolicyError(issues);

  return { resources, egress };
}

/** Decide whether the policy permits egress to `host` (`deny > allow > default`). */
export function evaluateEgress(egress: EgressPolicy, host: string): EgressAction {
  const h = host.trim().toLowerCase();
  if (egress.deny.some((pattern) => matchHost(pattern, h))) return 'deny';
  if (egress.allow.some((pattern) => matchHost(pattern, h))) return 'allow';
  return egress.defaultAction;
}

/** Convenience boolean form of {@link evaluateEgress}. */
export function isHostAllowed(egress: EgressPolicy, host: string): boolean {
  return evaluateEgress(egress, host) === 'allow';
}

function matchHost(pattern: string, host: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (p.startsWith('*.')) {
    const apex = p.slice(2); // "example.com"
    return host === apex || host.endsWith(`.${apex}`);
  }
  return host === p;
}

/** Thrown when an operation exceeds the policy's wall-clock limit. */
export class SandboxTimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`operation exceeded the ${ms}ms wall-clock limit`);
    this.name = 'SandboxTimeoutError';
  }
}

/**
 * Enforce a wall-clock limit on an in-process operation: resolve/reject with the
 * operation if it settles in time, otherwise reject with {@link SandboxTimeoutError}.
 * (The operation itself isn't force-killed — callers running a child process
 * should also terminate it; this is the in-process half of the limit.)
 */
export function enforceWallClock<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SandboxTimeoutError(ms)), ms);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}
