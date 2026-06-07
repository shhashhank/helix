/**
 * Image push to ECR (HELIX-125): given a locally-built image and an ECR target
 * (account / region / repository / tag), work out the registry URI, tag the image
 * for it, authenticate Docker against the registry, and push.
 *
 * `ecrRegistry` / `ecrImageUri` / `ecrPushCommands` are pure + deterministic;
 * `pushImageToEcr` runs the commands through the injected {@link CommandRunner}.
 * The real `aws ecr get-login-password` / `docker push` execution needs the AWS
 * CLI + a Docker daemon (not in CI), so it's a deferred binding — the URI
 * computation, command generation, and orchestration are real and offline-testable.
 */
import type { CommandRunner } from '@helix/sandbox';
import type { BuildCommand } from './build';

export interface EcrTarget {
  /** 12-digit AWS account id that owns the registry. */
  accountId: string;
  /** AWS region, e.g. `eu-west-1`. */
  region: string;
  /** ECR repository name, e.g. `helix/demo-app`. */
  repository: string;
  /** Image tag to push under (default `latest`). */
  tag?: string;
}

const DEFAULT_TAG = 'latest';

function assertValidTarget(target: EcrTarget): void {
  if (!/^\d{12}$/.test(target.accountId)) {
    throw new Error(`Invalid ECR account id: ${JSON.stringify(target.accountId)} (expected 12 digits)`);
  }
  if (!target.region.trim()) throw new Error('ECR target region is required');
  if (!target.repository.trim()) throw new Error('ECR target repository is required');
}

/** The registry host: `<accountId>.dkr.ecr.<region>.amazonaws.com`. */
export function ecrRegistry(target: EcrTarget): string {
  assertValidTarget(target);
  return `${target.accountId}.dkr.ecr.${target.region}.amazonaws.com`;
}

/** The fully-qualified image URI to push: `<registry>/<repository>:<tag>`. */
export function ecrImageUri(target: EcrTarget): string {
  return `${ecrRegistry(target)}/${target.repository}:${target.tag ?? DEFAULT_TAG}`;
}

/**
 * Authenticate Docker against the ECR registry. The AWS-recommended one-liner pipes
 * a short-lived token from the AWS CLI into `docker login`, so it's a single
 * shell-invoked command rather than a bare exec.
 */
export function ecrLoginCommand(target: EcrTarget): BuildCommand {
  const registry = ecrRegistry(target);
  return {
    command: 'sh',
    args: [
      '-c',
      `aws ecr get-login-password --region ${target.region} | ` +
        `docker login --username AWS --password-stdin ${registry}`,
    ],
  };
}

/** Tag the local image with the ECR URI. */
export function ecrTagCommand(localImage: string, target: EcrTarget): BuildCommand {
  return { command: 'docker', args: ['tag', localImage, ecrImageUri(target)] };
}

/** Push the tagged image to ECR. */
export function ecrPushCommand(target: EcrTarget): BuildCommand {
  return { command: 'docker', args: ['push', ecrImageUri(target)] };
}

/** The ordered commands to push a local image to ECR: login → tag → push. */
export function ecrPushCommands(localImage: string, target: EcrTarget): BuildCommand[] {
  return [ecrLoginCommand(target), ecrTagCommand(localImage, target), ecrPushCommand(target)];
}

export interface EcrPushOptions {
  /** Working dir for the commands, relative to the sandbox root (default `.`). */
  cwd?: string;
  timeoutMs?: number;
}

export interface PushStepResult {
  command: string;
  exitCode: number | null;
  ok: boolean;
  stderr: string;
  timedOut: boolean;
}

export interface PushResult {
  ok: boolean;
  /** The pushed image URI (computed even if the push fails). */
  uri: string;
  /** Per-command outcomes, in run order; truncated at the first failing step. */
  steps: PushStepResult[];
}

/**
 * Push a locally-built image to ECR via the command runner: login → tag → push,
 * stopping at the first failing step.
 */
export async function pushImageToEcr(
  runner: CommandRunner,
  localImage: string,
  target: EcrTarget,
  options: EcrPushOptions = {},
): Promise<PushResult> {
  const uri = ecrImageUri(target);
  const steps: PushStepResult[] = [];

  for (const cmd of ecrPushCommands(localImage, target)) {
    const exec = await runner.run(cmd.command, {
      args: cmd.args,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
    });
    const ok = exec.exitCode === 0 && !exec.timedOut;
    steps.push({
      command: exec.command,
      exitCode: exec.exitCode,
      ok,
      stderr: exec.stderr,
      timedOut: exec.timedOut,
    });
    if (!ok) return { ok: false, uri, steps };
  }

  return { ok: true, uri, steps };
}
