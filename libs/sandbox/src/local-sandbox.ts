/**
 * Local, temp-directory sandbox provider (HELIX-100). Provisions each sandbox as
 * a fresh directory under a base dir, tracks the active set, and disposes by
 * removing the directory. A real, working ephemeral workspace for dev and CI —
 * it gives filesystem isolation + a path-escape guard, but not the process /
 * network / resource isolation of a container; that's the deferred backend.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  Sandbox,
  SandboxPathError,
  SandboxProvider,
  SandboxProvisionOptions,
  SandboxStatus,
} from './sandbox';

export interface LocalSandboxProviderOptions {
  /** Base directory sandboxes are created under (default `<tmpdir>/helix-sandboxes`). */
  baseDir?: string;
}

export class LocalSandboxProvider implements SandboxProvider {
  private readonly baseDir: string;
  private readonly active = new Map<string, LocalSandbox>();

  constructor(options: LocalSandboxProviderOptions = {}) {
    this.baseDir = options.baseDir ?? join(tmpdir(), 'helix-sandboxes');
  }

  async provision(options: SandboxProvisionOptions = {}): Promise<Sandbox> {
    const id = `sbx-${randomUUID()}`;
    const rootDir = join(this.baseDir, id);
    await mkdir(rootDir, { recursive: true });
    const sandbox = new LocalSandbox(id, rootDir, options.label, () => {
      this.active.delete(id);
    });
    this.active.set(id, sandbox);
    return sandbox;
  }

  list(): Sandbox[] {
    return [...this.active.values()];
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.active.values()].map((s) => s.dispose()));
  }
}

class LocalSandbox implements Sandbox {
  readonly createdAt = new Date();
  private state: SandboxStatus = 'active';

  constructor(
    readonly id: string,
    readonly rootDir: string,
    readonly label: string | undefined,
    private readonly onDispose: () => void,
  ) {}

  status(): SandboxStatus {
    return this.state;
  }

  resolve(relativePath: string): string {
    const target = resolve(this.rootDir, relativePath);
    const rootPrefix = this.rootDir.endsWith(sep) ? this.rootDir : this.rootDir + sep;
    if (target !== this.rootDir && !target.startsWith(rootPrefix)) {
      throw new SandboxPathError(relativePath);
    }
    return target;
  }

  async dispose(): Promise<void> {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    await rm(this.rootDir, { recursive: true, force: true });
    this.onDispose();
  }
}
