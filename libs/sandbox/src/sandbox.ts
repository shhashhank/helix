/**
 * Sandbox seam for the Coding Agent (HELIX-100).
 *
 * The coding agent does its work — checking out a repo, editing files, building,
 * running tests — inside an **ephemeral, isolated workspace** that is thrown away
 * afterwards. This module defines that seam: a {@link SandboxProvider} that
 * provisions and disposes {@link Sandbox} workspaces. A {@link LocalSandbox}
 * (temp directory) implementation backs it for dev/CI; the production
 * container/microVM backend (Firecracker/Fargate) is a drop-in behind this seam
 * (see DEFERRED.md) — that's the high-risk infra spike, kept off the offline path.
 */
export type SandboxStatus = 'active' | 'disposed';

/** An ephemeral, isolated workspace. */
export interface Sandbox {
  readonly id: string;
  /** Absolute path to the workspace root. */
  readonly rootDir: string;
  /** Optional caller label for traceability (e.g. a run/task id). */
  readonly label?: string;
  readonly createdAt: Date;
  /** Current lifecycle status. */
  status(): SandboxStatus;
  /**
   * Resolve a workspace-relative path to an absolute one, **guarding against
   * escaping the root** (throws {@link SandboxPathError} for `../…` or absolute
   * paths that leave the sandbox). The isolation primitive callers build on.
   */
  resolve(relativePath: string): string;
  /** Remove the workspace and mark it disposed. Idempotent. */
  dispose(): Promise<void>;
}

export interface SandboxProvisionOptions {
  /** A label carried on the sandbox for traceability. */
  label?: string;
}

/** Provisions and tracks ephemeral sandboxes. */
export interface SandboxProvider {
  provision(options?: SandboxProvisionOptions): Promise<Sandbox>;
  /** Currently-active (not yet disposed) sandboxes. */
  list(): Sandbox[];
  /** Dispose every active sandbox (cleanup). */
  disposeAll(): Promise<void>;
}

/** Thrown when a path would resolve outside the sandbox root. */
export class SandboxPathError extends Error {
  constructor(public readonly attemptedPath: string) {
    super(`path "${attemptedPath}" escapes the sandbox root`);
    this.name = 'SandboxPathError';
  }
}
