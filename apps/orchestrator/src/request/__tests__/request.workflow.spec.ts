import { requestToWorkflow } from '../request.workflow';

describe('requestToWorkflow', () => {
  it('builds the standard pipeline (no delivery) when no repo is given', () => {
    const def = requestToWorkflow({ id: 'req-1' });
    expect(def.steps.map((s) => s.id)).toEqual(['plan', 'code', 'review', 'test', 'deploy']);
    expect(def.edges.some((e) => e.from === 'test' && e.to === 'deploy')).toBe(true);
    expect(def.steps.some((s) => s.agentRole === 'delivery')).toBe(false);
  });

  it('inserts a delivery step (test → deliver → deploy) carrying the repo config when a repo is given', () => {
    const repo = { owner: 'acme', repo: 'app', base: 'main', installationId: 'inst-1' };
    const def = requestToWorkflow({ id: 'req-2', repo });

    expect(def.steps.map((s) => s.id)).toEqual(['plan', 'code', 'review', 'test', 'deliver', 'deploy']);
    const deliver = def.steps.find((s) => s.id === 'deliver');
    expect(deliver?.agentRole).toBe('delivery');
    expect(deliver?.config).toEqual({ delivery: repo });
    expect(def.edges).toEqual(
      expect.arrayContaining([
        { from: 'test', to: 'deliver', when: 'success' },
        { from: 'deliver', to: 'deploy', when: 'success' },
      ]),
    );
  });
});
