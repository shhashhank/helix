import { InMemoryWorkingMemory } from '../lib/memory';

describe('InMemoryWorkingMemory', () => {
  let mem: InMemoryWorkingMemory;
  beforeEach(() => {
    mem = new InMemoryWorkingMemory();
  });

  it('sets and gets a value within a run', async () => {
    await mem.set('run1', 'plan', 'step A');
    expect(await mem.get('run1', 'plan')).toBe('step A');
  });

  it('returns null for a missing key or run', async () => {
    expect(await mem.get('run1', 'nope')).toBeNull();
    expect(await mem.get('ghost', 'plan')).toBeNull();
  });

  it('overwrites an existing key', async () => {
    await mem.set('run1', 'k', 'v1');
    await mem.set('run1', 'k', 'v2');
    expect(await mem.get('run1', 'k')).toBe('v2');
  });

  it('isolates runs from each other', async () => {
    await mem.set('run1', 'k', 'a');
    await mem.set('run2', 'k', 'b');
    expect(await mem.get('run1', 'k')).toBe('a');
    expect(await mem.get('run2', 'k')).toBe('b');
  });

  it('lists keys and entries for a run', async () => {
    await mem.set('run1', 'a', '1');
    await mem.set('run1', 'b', '2');
    expect((await mem.keys('run1')).sort()).toEqual(['a', 'b']);
    expect(await mem.entries('run1')).toEqual({ a: '1', b: '2' });
    expect(await mem.entries('other')).toEqual({});
  });

  it('deletes a key without touching the rest', async () => {
    await mem.set('run1', 'a', '1');
    await mem.set('run1', 'b', '2');
    await mem.delete('run1', 'a');
    expect(await mem.get('run1', 'a')).toBeNull();
    expect(await mem.get('run1', 'b')).toBe('2');
  });

  it('clears an entire run', async () => {
    await mem.set('run1', 'a', '1');
    await mem.clear('run1');
    expect(await mem.keys('run1')).toEqual([]);
  });
});
