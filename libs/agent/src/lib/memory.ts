/**
 * Per-run working memory: a small scratchpad an agent can read/write during a
 * run (HELIX-62), scoped by `runId` so concurrent runs never collide. Values
 * are strings — callers JSON-encode structured data. The default is in-process;
 * a Redis-backed implementation (see the registry app) shares it across workers.
 */
export interface WorkingMemoryStore {
  set(runId: string, key: string, value: string): Promise<void>;
  get(runId: string, key: string): Promise<string | null>;
  delete(runId: string, key: string): Promise<void>;
  keys(runId: string): Promise<string[]>;
  /** All key→value pairs for a run (empty object if none). */
  entries(runId: string): Promise<Record<string, string>>;
  /** Drop the whole run's scratchpad (e.g. when the run ends). */
  clear(runId: string): Promise<void>;
}

/** In-process {@link WorkingMemoryStore} — the default for tests, dev, and single-worker runs. */
export class InMemoryWorkingMemory implements WorkingMemoryStore {
  private readonly runs = new Map<string, Map<string, string>>();

  async set(runId: string, key: string, value: string): Promise<void> {
    let run = this.runs.get(runId);
    if (!run) {
      run = new Map();
      this.runs.set(runId, run);
    }
    run.set(key, value);
  }

  async get(runId: string, key: string): Promise<string | null> {
    return this.runs.get(runId)?.get(key) ?? null;
  }

  async delete(runId: string, key: string): Promise<void> {
    this.runs.get(runId)?.delete(key);
  }

  async keys(runId: string): Promise<string[]> {
    return [...(this.runs.get(runId)?.keys() ?? [])];
  }

  async entries(runId: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.runs.get(runId) ?? []);
  }

  async clear(runId: string): Promise<void> {
    this.runs.delete(runId);
  }
}
