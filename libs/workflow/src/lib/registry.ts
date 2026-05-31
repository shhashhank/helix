/**
 * Workflow versioning (HELIX-70). A {@link WorkflowRegistry} keeps an immutable,
 * append-only history of workflow definitions keyed by name. Each {@link publish}
 * validates the definition and stores it as the next version; old versions are
 * never overwritten.
 *
 * The point is **reproducible runs**: a run records a {@link WorkflowRef}
 * (`name` + `version`) via {@link WorkflowRegistry.pin} and later
 * {@link WorkflowRegistry.resolve}s it back to the exact definition it started
 * with — even if newer versions have been published in the meantime.
 */
import { WorkflowDefinition } from './types';
import { assertValidWorkflow } from './validator';

/** A workflow definition frozen at a specific version. */
export interface VersionedWorkflow {
  /** Workflow name — the identity shared across all versions. */
  name: string;
  /** 1-based, monotonically increasing per name. */
  version: number;
  /** The immutable definition snapshot (its `version` field equals {@link version}). */
  definition: WorkflowDefinition;
  /** When this version was published. */
  publishedAt: Date;
}

/** A pinned `(name, version)` pointer a run records to stay reproducible. */
export interface WorkflowRef {
  name: string;
  version: number;
}

/** Thrown when a name (or a specific `name@version`) isn't in the registry. */
export class WorkflowNotFoundError extends Error {
  constructor(
    public readonly workflowName: string,
    public readonly version?: number,
  ) {
    super(
      version === undefined
        ? `workflow "${workflowName}" not found`
        : `workflow "${workflowName}" has no version ${version}`,
    );
    this.name = 'WorkflowNotFoundError';
  }
}

/** Recursively freeze an object graph so stored snapshots can't be mutated. */
function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    for (const value of Object.values(obj)) deepFreeze(value);
    Object.freeze(obj);
  }
  return obj;
}

/**
 * In-memory, append-only store of versioned workflow definitions.
 *
 * Versions are immutable: {@link publish} always adds a new version rather than
 * mutating an existing one, and both the stored snapshot and what callers read
 * back are deep-frozen, deep-cloned copies — so neither mutating the input after
 * publishing nor mutating a returned snapshot can corrupt the history.
 */
export class WorkflowRegistry {
  /** name → versions, oldest first (index i holds version i+1). */
  private readonly byName = new Map<string, VersionedWorkflow[]>();

  /**
   * Validate `def` and store it as the next version of its workflow (version 1
   * if the name is new, else `latest + 1`). Returns the stored snapshot.
   *
   * @throws WorkflowValidationFailed if the definition is structurally invalid.
   */
  publish(def: WorkflowDefinition, now: Date = new Date()): VersionedWorkflow {
    assertValidWorkflow(def);
    const history = this.byName.get(def.name) ?? [];
    const version = history.length + 1;
    const snapshot = deepFreeze<VersionedWorkflow>({
      name: def.name,
      version,
      definition: cloneDefinition(def, version),
      publishedAt: new Date(now.getTime()),
    });
    history.push(snapshot);
    this.byName.set(def.name, history);
    return snapshot;
  }

  /** True if `name` exists (optionally, a specific `version` of it). */
  has(name: string, version?: number): boolean {
    const history = this.byName.get(name);
    if (!history || history.length === 0) return false;
    return version === undefined ? true : version >= 1 && version <= history.length;
  }

  /** Every published version of `name`, oldest first. Empty if unknown. */
  history(name: string): VersionedWorkflow[] {
    return [...(this.byName.get(name) ?? [])];
  }

  /** Version numbers published for `name`, ascending. Empty if unknown. */
  versions(name: string): number[] {
    return (this.byName.get(name) ?? []).map((v) => v.version);
  }

  /** Names of all workflows that have at least one version. */
  names(): string[] {
    return [...this.byName.keys()];
  }

  /** The latest version of `name`. @throws WorkflowNotFoundError if none. */
  latest(name: string): VersionedWorkflow {
    const history = this.byName.get(name);
    if (!history || history.length === 0) throw new WorkflowNotFoundError(name);
    return history[history.length - 1];
  }

  /**
   * A specific version of `name`, or the latest when `version` is omitted.
   * @throws WorkflowNotFoundError if the name or version is unknown.
   */
  get(name: string, version?: number): VersionedWorkflow {
    if (version === undefined) return this.latest(name);
    const found = (this.byName.get(name) ?? []).find((v) => v.version === version);
    if (!found) throw new WorkflowNotFoundError(name, version);
    return found;
  }

  /**
   * Pin a `(name, version)` pointer for a run to record. With no `version` it
   * pins the current latest — capturing "the definition as it is right now" so
   * the run stays reproducible even after newer versions are published.
   *
   * @throws WorkflowNotFoundError if the name (or version) is unknown.
   */
  pin(name: string, version?: number): WorkflowRef {
    const v = this.get(name, version);
    return { name: v.name, version: v.version };
  }

  /**
   * Resolve a previously pinned {@link WorkflowRef} back to its exact snapshot.
   * @throws WorkflowNotFoundError if the ref no longer resolves.
   */
  resolve(ref: WorkflowRef): VersionedWorkflow {
    return this.get(ref.name, ref.version);
  }
}

/** Deep-clone a definition and stamp its `version`, so the snapshot is self-describing. */
function cloneDefinition(def: WorkflowDefinition, version: number): WorkflowDefinition {
  return {
    name: def.name,
    version,
    steps: def.steps.map((s) => ({
      id: s.id,
      agentRole: s.agentRole,
      ...(s.name !== undefined ? { name: s.name } : {}),
      ...(s.config !== undefined ? { config: structuredClone(s.config) } : {}),
    })),
    edges: def.edges.map((e) => ({
      from: e.from,
      to: e.to,
      ...(e.when !== undefined ? { when: e.when } : {}),
    })),
  };
}
