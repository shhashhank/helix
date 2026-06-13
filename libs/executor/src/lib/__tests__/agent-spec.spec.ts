import { DEFAULT_AGENT_SPECS, DefaultAgentSpecResolver } from '../agent-spec';

describe('DefaultAgentSpecResolver', () => {
  const resolver = new DefaultAgentSpecResolver();

  it('resolves a spec for each standard pipeline role', async () => {
    for (const role of ['planning', 'coding', 'code_review', 'testing', 'deployment']) {
      const spec = await resolver.resolve(role);
      expect(spec).toBeDefined();
      expect(typeof spec!.system).toBe('string');
      expect(spec!.tier).toMatch(/^(opus|sonnet|haiku)$/);
    }
  });

  it('returns undefined for an unknown role', async () => {
    expect(await resolver.resolve('astrologer')).toBeUndefined();
  });

  it('lists the roles it knows', () => {
    expect(resolver.roles().sort()).toEqual(['code_review', 'coding', 'deployment', 'planning', 'testing']);
  });

  it('can be constructed with a custom spec map', async () => {
    const custom = new DefaultAgentSpecResolver({ triage: { system: 'triage things', tier: 'haiku' } });
    expect((await custom.resolve('triage'))?.tier).toBe('haiku');
    expect(await custom.resolve('coding')).toBeUndefined(); // not in the custom map
  });

  it('default specs cover exactly the pipeline roles', () => {
    expect(Object.keys(DEFAULT_AGENT_SPECS).sort()).toEqual([
      'code_review',
      'coding',
      'deployment',
      'planning',
      'testing',
    ]);
  });
});
