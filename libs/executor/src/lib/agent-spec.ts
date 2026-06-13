import type { AgentSpec } from '@helix/agent';

/**
 * Resolves the {@link AgentSpec} (system prompt, model tier, output schema, …) to
 * drive a given `agentRole` (HELIX-153). The per-role executor (HELIX-154) asks the
 * resolver for its spec, then hands it to `runAgent`.
 *
 * The seam lets the *source* of specs swap without touching executors:
 * {@link DefaultAgentSpecResolver} ships built-in defaults now; a registry-backed
 * resolver (the orchestrator's agent-definition API) drops in later. `AgentSpec` is
 * imported **as a type only**, so this lib stays runtime-dependency-free.
 */
export interface AgentSpecResolver {
  /** The spec for a role, or `undefined` if the role is unknown. */
  resolve(role: string): Promise<AgentSpec | undefined>;
}

/** Built-in per-role specs — the standard delivery pipeline roles. */
export const DEFAULT_AGENT_SPECS: Readonly<Record<string, AgentSpec>> = {
  planning: {
    system:
      'You are the Planning agent. Turn the request into a concrete implementation plan: ' +
      'an ordered task list with dependencies, the tech stack, and the files to create or change.',
    tier: 'opus',
    effort: 'high',
  },
  coding: {
    system:
      'You are the Coding agent. Implement the planned changes in the workspace. Write correct, ' +
      'idiomatic code that compiles and passes lint; make focused, well-grouped commits on a branch.',
    tier: 'opus',
    effort: 'high',
  },
  code_review: {
    system:
      'You are the Code Review agent. Review the diff for correctness, security, style, performance, ' +
      'and adherence to the plan. Report structured findings with severities and a merge recommendation.',
    tier: 'sonnet',
    effort: 'high',
  },
  testing: {
    system:
      'You are the Testing agent. Generate tests mapped to the acceptance criteria, run them in the ' +
      'sandbox, and report results and coverage. Feed failures back for fixing.',
    tier: 'sonnet',
    effort: 'high',
  },
  deployment: {
    system:
      'You are the Deployment agent. Build the artifact and deploy the demo stack, returning the live ' +
      'URL. Wire required env/config and referenced secrets.',
    tier: 'sonnet',
    effort: 'medium',
  },
};

/**
 * Resolves roles from a fixed map of {@link AgentSpec}s — {@link DEFAULT_AGENT_SPECS}
 * by default. The registry-backed resolver (deferred) implements the same seam.
 */
export class DefaultAgentSpecResolver implements AgentSpecResolver {
  constructor(private readonly specs: Readonly<Record<string, AgentSpec>> = DEFAULT_AGENT_SPECS) {}

  async resolve(role: string): Promise<AgentSpec | undefined> {
    return this.specs[role];
  }

  /** The roles this resolver can resolve. */
  roles(): string[] {
    return Object.keys(this.specs);
  }
}
