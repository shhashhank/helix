import { WorkflowDefinition } from '../lib/types';
import { WorkflowValidationFailed } from '../lib/validator';
import { WorkflowNotFoundError, WorkflowRegistry } from '../lib/registry';

const wf = (overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  name: 'plan-code-review',
  steps: [
    { id: 'plan', agentRole: 'planning' },
    { id: 'code', agentRole: 'coding' },
    { id: 'review', agentRole: 'code_review' },
  ],
  edges: [
    { from: 'plan', to: 'code' },
    { from: 'code', to: 'review', when: 'success' },
  ],
  ...overrides,
});

describe('WorkflowRegistry — publishing versions', () => {
  it('assigns version 1 to a new name and increments on each publish', () => {
    const reg = new WorkflowRegistry();
    expect(reg.publish(wf()).version).toBe(1);
    expect(reg.publish(wf()).version).toBe(2);
    expect(reg.publish(wf()).version).toBe(3);
    expect(reg.versions('plan-code-review')).toEqual([1, 2, 3]);
  });

  it('versions each workflow name independently', () => {
    const reg = new WorkflowRegistry();
    reg.publish(wf({ name: 'alpha' }));
    reg.publish(wf({ name: 'beta' }));
    reg.publish(wf({ name: 'alpha' }));
    expect(reg.versions('alpha')).toEqual([1, 2]);
    expect(reg.versions('beta')).toEqual([1]);
    expect(reg.names().sort()).toEqual(['alpha', 'beta']);
  });

  it('validates before storing — an invalid definition is rejected', () => {
    const reg = new WorkflowRegistry();
    expect(() => reg.publish({ name: '', steps: [], edges: [] })).toThrow(WorkflowValidationFailed);
    expect(reg.has('')).toBe(false);
  });

  it('stamps the assigned version onto the stored definition', () => {
    const reg = new WorkflowRegistry();
    const v1 = reg.publish(wf({ version: 99 })); // caller-supplied version is overridden
    expect(v1.definition.version).toBe(1);
    expect(reg.publish(wf()).definition.version).toBe(2);
  });
});

describe('WorkflowRegistry — lookup', () => {
  it('get/latest/has resolve known and unknown entries', () => {
    const reg = new WorkflowRegistry();
    reg.publish(wf());
    reg.publish(wf());

    expect(reg.latest('plan-code-review').version).toBe(2);
    expect(reg.get('plan-code-review', 1).version).toBe(1);
    expect(reg.get('plan-code-review').version).toBe(2); // defaults to latest
    expect(reg.has('plan-code-review', 1)).toBe(true);
    expect(reg.has('plan-code-review', 5)).toBe(false);

    expect(() => reg.get('ghost')).toThrow(WorkflowNotFoundError);
    expect(() => reg.get('plan-code-review', 9)).toThrow(WorkflowNotFoundError);
    expect(() => reg.latest('ghost')).toThrow(WorkflowNotFoundError);
  });
});

describe('WorkflowRegistry — pin & resolve (reproducible runs)', () => {
  it('pins the latest version by default and resolves it back', () => {
    const reg = new WorkflowRegistry();
    reg.publish(wf());
    reg.publish(wf());
    const ref = reg.pin('plan-code-review');
    expect(ref).toEqual({ name: 'plan-code-review', version: 2 });
    expect(reg.resolve(ref).version).toBe(2);
  });

  it('a pinned run keeps its version even after newer versions are published', () => {
    const reg = new WorkflowRegistry();
    reg.publish(wf({ steps: [{ id: 'only', agentRole: 'planning' }], edges: [] })); // v1
    const ref = reg.pin('plan-code-review'); // run pins v1

    reg.publish(wf()); // v2 — a different shape, published later

    const resolved = reg.resolve(ref);
    expect(resolved.version).toBe(1);
    expect(resolved.definition.steps.map((s) => s.id)).toEqual(['only']); // still v1's shape
  });

  it('can pin an explicit older version', () => {
    const reg = new WorkflowRegistry();
    reg.publish(wf());
    reg.publish(wf());
    expect(reg.pin('plan-code-review', 1)).toEqual({ name: 'plan-code-review', version: 1 });
    expect(() => reg.pin('plan-code-review', 7)).toThrow(WorkflowNotFoundError);
  });
});

describe('WorkflowRegistry — immutability', () => {
  it('is unaffected by mutating the input after publishing', () => {
    const reg = new WorkflowRegistry();
    const input = wf();
    reg.publish(input);
    input.steps.push({ id: 'sneaky', agentRole: 'x' });
    input.name = 'tampered';
    expect(reg.get('plan-code-review', 1).definition.steps.map((s) => s.id)).toEqual([
      'plan',
      'code',
      'review',
    ]);
  });

  it('returns deep-frozen snapshots that cannot be mutated', () => {
    const reg = new WorkflowRegistry();
    const snap = reg.publish(wf());
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.definition)).toBe(true);
    expect(Object.isFrozen(snap.definition.steps)).toBe(true);
    expect(() => {
      (snap.definition.steps as { id: string }[]).push({ id: 'no' });
    }).toThrow();
  });
});
