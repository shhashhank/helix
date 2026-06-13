import type { WorkflowProgress } from '@helix/workflow';

/**
 * The outputs a run produced, normalized for display (HELIX-147): the pull request
 * the coding/review agents opened, the testing agent's results, and the deployment
 * agent's live URL. All optional — a run surfaces whichever its steps have produced
 * so far (e.g. nothing yet while it's still planning).
 */
export interface RunArtifacts {
  pullRequest?: { url: string; title?: string };
  tests?: { passed: number; failed: number; coverage?: number };
  deployment?: { url: string; environment?: string };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function pickString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function pickNumber(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * Pull PR / test / deploy artifacts out of a run's per-step outputs (HELIX-147).
 * Source-agnostic: it scans each step's `output` for the well-known fields the
 * agents emit, so the same surfacing works regardless of which step produced them.
 * First match per artifact type wins (steps visited in id order).
 */
export function extractArtifacts(progress: Pick<WorkflowProgress, 'steps'>): RunArtifacts {
  const artifacts: RunArtifacts = {};

  for (const step of Object.values(progress.steps)) {
    const out = asRecord(step.output);
    if (!out) continue;

    if (!artifacts.pullRequest) {
      const url = pickString(out, ['pullRequestUrl', 'prUrl']);
      if (url) {
        const title = pickString(out, ['pullRequestTitle', 'prTitle']);
        artifacts.pullRequest = title ? { url, title } : { url };
      }
    }

    if (!artifacts.tests) {
      const t = asRecord(out.tests);
      if (t) {
        const passed = pickNumber(t, ['passed']);
        const failed = pickNumber(t, ['failed']);
        if (passed !== undefined && failed !== undefined) {
          const coverage = pickNumber(t, ['coverage']);
          artifacts.tests = coverage !== undefined ? { passed, failed, coverage } : { passed, failed };
        }
      }
    }

    if (!artifacts.deployment) {
      const url = pickString(out, ['liveUrl', 'deployUrl', 'deploymentUrl']);
      if (url) {
        const environment = pickString(out, ['environment', 'env']);
        artifacts.deployment = environment ? { url, environment } : { url };
      }
    }
  }

  return artifacts;
}
