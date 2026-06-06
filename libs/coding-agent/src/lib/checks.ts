/**
 * Build/lint checks (HELIX-106): run the stack's verification commands in the
 * sandbox and report structured pass/fail + output. This is the foundation of
 * the self-correction loop — HELIX-107 turns the captured failures into fix
 * feedback, HELIX-108 caps the iterations.
 *
 * Commands are language-aware (configurable per stack; `nodeChecks` gives the
 * usual Node build + lint), and run through the injected {@link CommandRunner}
 * so the orchestration is testable with a fake while the real runner spawns
 * processes in the workspace.
 */
import type { CommandRunner } from '@helix/sandbox';

export interface CheckCommand {
  /** Label, e.g. "build" or "lint". */
  name: string;
  command: string;
  args?: string[];
}

export interface CheckResult {
  name: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ChecksOutcome {
  /** True only if every check that ran passed. */
  ok: boolean;
  results: CheckResult[];
}

export interface RunChecksOptions {
  /** Working dir relative to the sandbox root. */
  cwd?: string;
  /** Per-command wall-clock timeout (ms). */
  timeoutMs?: number;
  /** Stop after the first failing check (default: run them all). */
  stopOnFailure?: boolean;
}

/** Run the checks in order and aggregate the outcome. */
export async function runChecks(
  runner: CommandRunner,
  checks: CheckCommand[],
  options: RunChecksOptions = {},
): Promise<ChecksOutcome> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    const exec = await runner.run(check.command, {
      args: check.args,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
    });
    const ok = exec.exitCode === 0 && !exec.timedOut;
    results.push({
      name: check.name,
      ok,
      exitCode: exec.exitCode,
      timedOut: exec.timedOut,
      stdout: exec.stdout,
      stderr: exec.stderr,
      durationMs: exec.durationMs,
    });
    if (!ok && options.stopOnFailure) break;
  }
  return { ok: results.every((r) => r.ok), results };
}

export type PackageManager = 'pnpm' | 'npm' | 'yarn';

/** Default Node build + lint checks for a package manager (a language-aware preset). */
export function nodeChecks(packageManager: PackageManager = 'pnpm'): CheckCommand[] {
  const script = (name: string): { command: string; args: string[] } =>
    packageManager === 'npm'
      ? { command: 'npm', args: ['run', name] }
      : { command: packageManager, args: [name] };
  return [
    { name: 'build', ...script('build') },
    { name: 'lint', ...script('lint') },
  ];
}
