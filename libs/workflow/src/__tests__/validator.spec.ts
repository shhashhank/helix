import { WorkflowDefinition } from '../lib/types';
import {
  WorkflowValidationFailed,
  assertValidWorkflow,
  entrySteps,
  findCycle,
  validateWorkflow,
} from '../lib/validator';

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

const codes = (def: WorkflowDefinition) => validateWorkflow(def).errors.map((e) => e.code);

describe('validateWorkflow', () => {
  it('accepts a well-formed linear DAG', () => {
    expect(validateWorkflow(wf())).toEqual({ valid: true, errors: [] });
  });

  it('accepts branching + conditional edges', () => {
    const def = wf({
      steps: [
        { id: 'plan', agentRole: 'planning' },
        { id: 'code', agentRole: 'coding' },
        { id: 'fix', agentRole: 'coding' },
        { id: 'review', agentRole: 'code_review' },
      ],
      edges: [
        { from: 'plan', to: 'code' },
        { from: 'code', to: 'review', when: 'success' },
        { from: 'code', to: 'fix', when: 'failure' },
        { from: 'fix', to: 'review', when: 'always' },
      ],
    });
    expect(validateWorkflow(def).valid).toBe(true);
  });

  it('requires a name and at least one step', () => {
    expect(codes(wf({ name: ' ' }))).toContain('EMPTY_NAME');
    expect(codes({ name: 'x', steps: [], edges: [] })).toEqual(['NO_STEPS']);
  });

  it('flags invalid + duplicate step ids and missing agent role', () => {
    const def = wf({
      steps: [
        { id: 'a b', agentRole: 'x' }, // invalid chars
        { id: 'dup', agentRole: 'x' },
        { id: 'dup', agentRole: '' }, // duplicate + empty role
      ],
      edges: [],
    });
    const c = codes(def);
    expect(c).toContain('INVALID_STEP_ID');
    expect(c).toContain('DUPLICATE_STEP_ID');
    expect(c).toContain('EMPTY_AGENT_ROLE');
  });

  it('flags edges to/from unknown steps, self-edges, and duplicates', () => {
    const def = wf({
      steps: [{ id: 'a', agentRole: 'x' }],
      edges: [
        { from: 'a', to: 'ghost' },
        { from: 'nope', to: 'a' },
        { from: 'a', to: 'a' },
      ],
    });
    const c = codes(def);
    expect(c).toContain('EDGE_UNKNOWN_TO');
    expect(c).toContain('EDGE_UNKNOWN_FROM');
    expect(c).toContain('SELF_EDGE');
  });

  it('flags an invalid edge condition', () => {
    const def = wf({ edges: [{ from: 'plan', to: 'code', when: 'maybe' as never }] });
    expect(codes(def)).toContain('INVALID_CONDITION');
  });

  it('detects a cycle', () => {
    const def = wf({
      edges: [
        { from: 'plan', to: 'code' },
        { from: 'code', to: 'review' },
        { from: 'review', to: 'plan' }, // cycle
      ],
    });
    const result = validateWorkflow(def);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(expect.arrayContaining(['CYCLE', 'NO_ENTRY_STEP']));
  });

  it('flags a graph with no entry step', () => {
    // two nodes pointing at each other → both have incoming edges
    const def = wf({
      steps: [
        { id: 'a', agentRole: 'x' },
        { id: 'b', agentRole: 'x' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    });
    expect(codes(def)).toContain('NO_ENTRY_STEP');
  });
});

describe('graph helpers', () => {
  it('entrySteps returns roots (no incoming edge)', () => {
    expect(entrySteps(wf())).toEqual(['plan']);
  });

  it('findCycle returns the cycle path, else null', () => {
    expect(findCycle(wf())).toBeNull();
    const cyc = findCycle(wf({ edges: [{ from: 'plan', to: 'code' }, { from: 'code', to: 'plan' }] }));
    expect(cyc?.[0]).toBe(cyc?.[cyc.length - 1]); // closes the loop
  });
});

describe('assertValidWorkflow', () => {
  it('throws WorkflowValidationFailed on an invalid definition', () => {
    expect(() => assertValidWorkflow({ name: '', steps: [], edges: [] })).toThrow(WorkflowValidationFailed);
  });

  it('does not throw on a valid definition', () => {
    expect(() => assertValidWorkflow(wf())).not.toThrow();
  });
});
