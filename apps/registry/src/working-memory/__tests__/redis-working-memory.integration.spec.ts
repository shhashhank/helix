import Redis from 'ioredis';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { RedisWorkingMemory } from '../redis-working-memory';

describe('RedisWorkingMemory — integration (real Redis via testcontainers)', () => {
  let container: StartedTestContainer;
  let redis: Redis;
  let mem: RedisWorkingMemory;

  beforeAll(async () => {
    container = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
    redis = new Redis({ host: container.getHost(), port: container.getMappedPort(6379) });
    mem = new RedisWorkingMemory(redis, { ttlSeconds: 60 });
  }, 120_000);

  afterAll(async () => {
    redis?.disconnect();
    await container?.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  it('round-trips set/get scoped by run', async () => {
    await mem.set('run1', 'plan', 'step A');
    expect(await mem.get('run1', 'plan')).toBe('step A');
    expect(await mem.get('run1', 'missing')).toBeNull();
    expect(await mem.get('other-run', 'plan')).toBeNull();
  });

  it('lists keys + entries and deletes a single key', async () => {
    await mem.set('run1', 'a', '1');
    await mem.set('run1', 'b', '2');
    expect((await mem.keys('run1')).sort()).toEqual(['a', 'b']);
    expect(await mem.entries('run1')).toEqual({ a: '1', b: '2' });

    await mem.delete('run1', 'a');
    expect(await mem.get('run1', 'a')).toBeNull();
    expect(await mem.entries('run1')).toEqual({ b: '2' });
  });

  it('clears a whole run', async () => {
    await mem.set('run1', 'a', '1');
    await mem.clear('run1');
    expect(await mem.keys('run1')).toEqual([]);
  });

  it('sets a TTL on the run hash', async () => {
    await mem.set('run1', 'a', '1');
    const ttl = await redis.ttl('helix:wm:run1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });
});
