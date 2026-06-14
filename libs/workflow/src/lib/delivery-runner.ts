/**
 * Sandbox-backed GitHub delivery runner (HELIX-186) — the worker impl of the executor's
 * `GitHubDeliveryRunner` seam (HELIX-183). At the delivery step it reads the run's target
 * repo from the step config, captures the run's sandbox change-set, builds an installation-
 * scoped GitHub client (HELIX-184), and opens a PR (`deliverChangeSet`, HELIX-182). It
 * **skips gracefully** (benign success, with the change-set still surfaced) when there's no
 * target repo, no GitHub App configured, or nothing changed — so the run always completes.
 *
 * Pure over its injected deps (change-set source + client factory), so it's offline-tested
 * with fakes; the dev worker wires the real sandbox + Octokit in.
 */
import { deliverChangeSet } from '@helix/github-mcp/delivery';
import type { CommitFile, GitHubClient } from '@helix/github-mcp';
import type { ChangeSetSummary, ExecutableStep, GitHubDeliveryRunner, RunContext } from '@helix/executor';

/** Where a run's PR goes — read from the delivery step's config (the request's `repo`). */
export interface DeliveryTarget {
  owner: string;
  repo: string;
  base?: string;
  /** The org's GitHub App installation to act as. */
  installationId: string;
}

/** A run's changed files (add/update) + a summary, captured from its sandbox. */
export interface RunChangeSet {
  files: CommitFile[];
  summary: ChangeSetSummary;
}

export interface SandboxDeliveryRunnerDeps {
  /** The run's changed files + summary (from the sandbox); `undefined` → nothing to deliver. */
  changeSet: (step: ExecutableStep, ctx: RunContext) => Promise<RunChangeSet | undefined>;
  /** Build an installation-scoped GitHub client; **omit when no App is configured** (→ skip). */
  createClient?: (installationId: string) => Promise<GitHubClient>;
  /** Read the target from the step config (default: `step.config.delivery`). */
  target?: (step: ExecutableStep, ctx: RunContext) => DeliveryTarget | undefined;
  /** Branch name for the run (default `helix/<runId>`). */
  branchFor?: (ctx: RunContext) => string;
}

/** Read + validate a {@link DeliveryTarget} from `step.config.delivery`. */
export function deliveryTargetFromConfig(step: ExecutableStep): DeliveryTarget | undefined {
  const raw = step.config?.['delivery'];
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o['owner'] === 'string' && typeof o['repo'] === 'string' && typeof o['installationId'] === 'string') {
    return {
      owner: o['owner'],
      repo: o['repo'],
      base: typeof o['base'] === 'string' ? o['base'] : undefined,
      installationId: o['installationId'],
    };
  }
  return undefined;
}

const defaultBranch = (ctx: RunContext): string => `helix/${ctx.runId ?? 'run'}`;

/** Build the worker's {@link GitHubDeliveryRunner}. */
export function sandboxDeliveryRunner(deps: SandboxDeliveryRunnerDeps): GitHubDeliveryRunner {
  const readTarget = deps.target ?? deliveryTargetFromConfig;
  const branchFor = deps.branchFor ?? defaultBranch;

  return {
    async deliver({ step, ctx }) {
      const target = readTarget(step, ctx);
      if (!target) return { delivered: false, skippedReason: 'no delivery target configured' };
      if (!deps.createClient) return { delivered: false, skippedReason: 'GitHub App not configured' };

      const cs = await deps.changeSet(step, ctx);
      if (!cs || cs.files.length === 0) {
        return { delivered: false, skippedReason: 'no changes to deliver', changeSet: cs?.summary };
      }

      try {
        const client = await deps.createClient(target.installationId);
        const ref = ctx.runId ?? step.id;
        const pr = await deliverChangeSet({
          client,
          owner: target.owner,
          repo: target.repo,
          base: target.base,
          branch: branchFor(ctx),
          message: `Helix run ${ref}`,
          files: cs.files,
          title: `Helix: changes from run ${ref}`,
          body: 'Automated change set produced by a Helix run.',
        });
        return { delivered: true, pullRequest: { number: pr.number, url: pr.url }, changeSet: cs.summary };
      } catch (err) {
        return { delivered: false, error: err instanceof Error ? err.message : String(err), changeSet: cs.summary };
      }
    },
  };
}
