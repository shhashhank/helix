import type { Redis } from 'ioredis';
// Type-only import — no runtime dependency on the agent library.
import type { WorkingMemoryStore } from '@helix/agent';

export interface RedisWorkingMemoryOptions {
  /** Key namespace; the per-run hash is `<keyPrefix>:<runId>`. Default `helix:wm`. */
  keyPrefix?: string;
  /** If set, each touched run's scratchpad expires after this many seconds. */
  ttlSeconds?: number;
}

/**
 * Redis-backed {@link WorkingMemoryStore} (HELIX-62). Each run's scratchpad is a
 * single Redis hash (`helix:wm:<runId>`), so a run's keys live and expire
 * together and are shared across workers. Implements the `@helix/agent`
 * contract so the agent runtime stays unaware of Redis.
 */
export class RedisWorkingMemory implements WorkingMemoryStore {
  private readonly keyPrefix: string;
  private readonly ttlSeconds?: number;

  constructor(
    private readonly redis: Redis,
    options: RedisWorkingMemoryOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? 'helix:wm';
    this.ttlSeconds = options.ttlSeconds;
  }

  private runKey(runId: string): string {
    return `${this.keyPrefix}:${runId}`;
  }

  async set(runId: string, key: string, value: string): Promise<void> {
    const k = this.runKey(runId);
    await this.redis.hset(k, key, value);
    if (this.ttlSeconds) await this.redis.expire(k, this.ttlSeconds);
  }

  async get(runId: string, key: string): Promise<string | null> {
    return this.redis.hget(this.runKey(runId), key);
  }

  async delete(runId: string, key: string): Promise<void> {
    await this.redis.hdel(this.runKey(runId), key);
  }

  async keys(runId: string): Promise<string[]> {
    return this.redis.hkeys(this.runKey(runId));
  }

  async entries(runId: string): Promise<Record<string, string>> {
    return this.redis.hgetall(this.runKey(runId));
  }

  async clear(runId: string): Promise<void> {
    await this.redis.del(this.runKey(runId));
  }
}
