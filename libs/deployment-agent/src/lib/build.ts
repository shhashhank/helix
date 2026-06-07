/**
 * Build & artifact packaging (HELIX-124): work out *how* to build the app from
 * its files (a Dockerfile, or a language buildpack) and produce the build
 * command, then run it.
 *
 * `detectBuildStrategy` is pure + deterministic; `runBuild` executes the build
 * through the injected {@link CommandRunner}. The actual `docker build` / `pack`
 * execution needs a Docker daemon (not in CI), so it's a deferred binding — the
 * detection, command generation, and orchestration are real and offline-testable.
 */
import type { CommandRunner } from '@helix/sandbox';

export interface ProjectFile {
  path: string;
  content: string;
}

export type BuildKind = 'dockerfile' | 'buildpack';
export type BuildLanguage = 'node' | 'python' | 'go' | 'java' | 'unknown';

export interface BuildStrategy {
  kind: BuildKind;
  /** For `dockerfile`: the Dockerfile path. */
  dockerfile?: string;
  /** For `buildpack`: the detected language. */
  language?: BuildLanguage;
}

/** Detect how to build the project: a Dockerfile if present, else a language buildpack. */
export function detectBuildStrategy(files: ProjectFile[]): BuildStrategy {
  const dockerfile = files.find((f) => f.path === 'Dockerfile' || f.path.endsWith('/Dockerfile'));
  if (dockerfile) return { kind: 'dockerfile', dockerfile: dockerfile.path };
  return { kind: 'buildpack', language: detectLanguage(files) };
}

function detectLanguage(files: ProjectFile[]): BuildLanguage {
  const has = (name: string) => files.some((f) => f.path === name || f.path.endsWith(`/${name}`));
  if (has('package.json')) return 'node';
  if (has('go.mod')) return 'go';
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py')) return 'python';
  if (has('pom.xml') || has('build.gradle') || has('build.gradle.kts')) return 'java';
  return 'unknown';
}

export interface BuildCommand {
  command: string;
  args: string[];
}

export interface BuildOptions {
  /** Image name/tag, e.g. `helix-app:latest`. */
  image: string;
  /** Buildpack builder image (default Paketo base). */
  builder?: string;
  /** Build context / working dir, relative to the sandbox root (default `.`). */
  cwd?: string;
  timeoutMs?: number;
}

const DEFAULT_BUILDER = 'paketobuildpacks/builder-jammy-base';

/** Build the command for a strategy: `docker build` for a Dockerfile, `pack build` for a buildpack. */
export function buildCommand(strategy: BuildStrategy, options: BuildOptions): BuildCommand {
  if (strategy.kind === 'dockerfile') {
    const dockerfile = strategy.dockerfile ?? 'Dockerfile';
    return { command: 'docker', args: ['build', '-t', options.image, '-f', dockerfile, '.'] };
  }
  return {
    command: 'pack',
    args: ['build', options.image, '--builder', options.builder ?? DEFAULT_BUILDER],
  };
}

export interface BuildResult {
  ok: boolean;
  image: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  command: string;
}

/** Run the build for a strategy via the command runner. */
export async function runBuild(
  runner: CommandRunner,
  strategy: BuildStrategy,
  options: BuildOptions,
): Promise<BuildResult> {
  const cmd = buildCommand(strategy, options);
  const exec = await runner.run(cmd.command, {
    args: cmd.args,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
  });
  return {
    ok: exec.exitCode === 0 && !exec.timedOut,
    image: options.image,
    exitCode: exec.exitCode,
    stdout: exec.stdout,
    stderr: exec.stderr,
    timedOut: exec.timedOut,
    command: exec.command,
  };
}
