/**
 * Test runner (HELIX-119): detect the project's test framework and run its tests
 * in the sandbox, capturing pass/fail + output.
 *
 * `detectFramework` inspects project files (package.json deps, pytest markers);
 * `runTests` executes the framework's test command through the injected
 * {@link CommandRunner} (the real, offline-tested local runner from
 * `@helix/sandbox`) and reports the result. The result/coverage parsing is
 * HELIX-120; this owns *running* the tests.
 */
import type { CommandRunner } from '@helix/sandbox';
import { SourceFile, TestFramework } from './test-generation';

export type PackageManager = 'pnpm' | 'npm' | 'yarn';

export interface TestCommand {
  command: string;
  args?: string[];
}

/** Detect the test framework from project files; `undefined` if none recognised. */
export function detectFramework(files: SourceFile[]): TestFramework | undefined {
  const pkg = files.find((f) => f.path === 'package.json' || f.path.endsWith('/package.json'));
  if (pkg) {
    const deps = parseDeps(pkg.content);
    if (deps.has('vitest')) return 'vitest';
    if (deps.has('jest') || deps.has('ts-jest') || deps.has('@jest/globals')) return 'jest';
    if (deps.has('mocha')) return 'mocha';
  }

  const hasPytest = files.some(
    (f) =>
      f.path.endsWith('conftest.py') ||
      ((f.path.endsWith('pyproject.toml') ||
        f.path.endsWith('requirements.txt') ||
        f.path.endsWith('setup.cfg')) &&
        /pytest/i.test(f.content)),
  );
  if (hasPytest) return 'pytest';

  return undefined;
}

function parseDeps(packageJson: string): Set<string> {
  try {
    const json = JSON.parse(packageJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return new Set([...Object.keys(json.dependencies ?? {}), ...Object.keys(json.devDependencies ?? {})]);
  } catch {
    return new Set();
  }
}

/** The default test command for a framework (Node frameworks via the package `test` script). */
export function defaultTestCommand(
  framework: TestFramework,
  packageManager: PackageManager = 'pnpm',
): TestCommand {
  if (framework === 'pytest') return { command: 'pytest', args: [] };
  return packageManager === 'npm'
    ? { command: 'npm', args: ['test'] }
    : { command: packageManager, args: ['test'] };
}

export interface TestRunResult {
  passed: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  command: string;
}

export interface RunTestsOptions {
  /** Explicit command (overrides framework detection). */
  command?: TestCommand;
  /** Framework to derive the default command from (default `jest`). */
  framework?: TestFramework;
  packageManager?: PackageManager;
  /** Working dir relative to the sandbox root. */
  cwd?: string;
  /** Wall-clock timeout (ms); the process is killed on overrun. */
  timeoutMs?: number;
}

/** Run the project's tests in the sandbox and report pass/fail + output. */
export async function runTests(
  runner: CommandRunner,
  options: RunTestsOptions = {},
): Promise<TestRunResult> {
  const command =
    options.command ?? defaultTestCommand(options.framework ?? 'jest', options.packageManager);
  const exec = await runner.run(command.command, {
    args: command.args,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
  });
  return {
    passed: exec.exitCode === 0 && !exec.timedOut,
    exitCode: exec.exitCode,
    stdout: exec.stdout,
    stderr: exec.stderr,
    timedOut: exec.timedOut,
    durationMs: exec.durationMs,
    command: exec.command,
  };
}
