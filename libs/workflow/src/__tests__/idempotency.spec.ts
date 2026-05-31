import { IdempotencyGuard, IdempotencyStore, InMemoryIdempotencyStore } from '../lib/idempotency';

describe('IdempotencyGuard', () => {
  it('runs fn once per key and replays the stored result afterwards', async () => {
    const guard = new IdempotencyGuard(new InMemoryIdempotencyStore());
    let calls = 0;
    const fn = () => {
      calls++;
      return 'charged';
    };

    const first = await guard.runOnce('charge', fn);
    const second = await guard.runOnce('charge', fn);

    expect(first).toEqual({ value: 'charged', executed: true });
    expect(second).toEqual({ value: 'charged', executed: false });
    expect(calls).toBe(1);
    expect(await guard.has('charge')).toBe(true);
  });

  it('treats different keys independently', async () => {
    const guard = new IdempotencyGuard(new InMemoryIdempotencyStore());
    let calls = 0;
    await guard.runOnce('a', () => ++calls);
    await guard.runOnce('b', () => ++calls);
    expect(calls).toBe(2);
  });

  it('single-flights concurrent calls for the same key (runs once)', async () => {
    const guard = new IdempotencyGuard(new InMemoryIdempotencyStore());
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return 'v';
    };

    const [a, b] = await Promise.all([guard.runOnce('k', fn), guard.runOnce('k', fn)]);

    expect(calls).toBe(1);
    expect(a.value).toBe('v');
    expect(b.value).toBe('v');
    expect([a.executed, b.executed].filter(Boolean)).toHaveLength(1); // exactly one executed
  });

  it('does not cache failures — a later attempt retries', async () => {
    const guard = new IdempotencyGuard(new InMemoryIdempotencyStore());
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls === 1) throw new Error('boom');
      return 'ok';
    };

    await expect(guard.runOnce('k', fn)).rejects.toThrow('boom');
    expect(await guard.has('k')).toBe(false); // failure not recorded
    const retry = await guard.runOnce('k', fn);
    expect(retry).toEqual({ value: 'ok', executed: true });
    expect(calls).toBe(2);
  });

  it('reads/writes through the injected store (cross-process dedupe shape)', async () => {
    const get = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockResolvedValue(undefined);
    const store: IdempotencyStore = {
      get: (key: string) => get(key),
      set: (key: string, record) => set(key, record),
    };

    const r = await new IdempotencyGuard(store).runOnce('k', () => 42);

    expect(r).toEqual({ value: 42, executed: true });
    expect(get).toHaveBeenCalledWith('k');
    expect(set).toHaveBeenCalledWith('k', { value: 42 });
  });
});
