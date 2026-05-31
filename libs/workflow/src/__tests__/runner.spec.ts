import { runWorkflow, WorkflowStepRunner } from '../lib/runner';
import { WorkflowDefinition } from '../lib/types';

// plan → code; code --success--> review; code --failure--> fix; fix --always--> review
const branching: WorkflowDefinition = {
  name: 'plan-code-review',
  steps: [
    { id: 'plan', agentRole: 'planning' },
    { id: 'code', agentRole: 'coding' },
    { id: 'fix', agentRole: 'coding' },
    { id: 'review', agentRole: 'code_review' },
  ],
  edges: [
    { from: 'plan', to: 'code', when: 'success' },
    { from: 'code', to: 'review', when: 'success' },
    { from: 'code', to: 'fix', when: 'failure' },
    { from: 'fix', to: 'review', when: 'always' },
  ],
};

/** Runner that returns a preset status per step id (default success), recording calls. */
function presetRunner(statuses: Record<string, 'success' | 'failure'> = {}) {
  const calls: string[] = [];
  const runner: WorkflowStepRunner = (step) => {
    calls.push(step.id);
    return { status: statuses[step.id] ?? 'success', output: `${step.id}-out` };
  };
  return { runner, calls };
}

describe('runWorkflow — branching by outcome', () => {
  it('takes the success path and skips the failure branch', async () => {
    const { runner, calls } = presetRunner(); // all succeed
    const r = await runWorkflow(branching, runner);

    expect(calls).toEqual(['plan', 'code', 'review']); // fix skipped, not called
    expect(r.completed.sort()).toEqual(['code', 'plan', 'review']);
    expect(r.skipped).toEqual(['fix']);
    expect(r.steps.review.ran).toBe(true);
  });

  it('takes the failure path: runs fix, then review via the always edge', async () => {
    const { runner, calls } = presetRunner({ code: 'failure' });
    const r = await runWorkflow(branching, runner);

    expect(calls).toEqual(['plan', 'code', 'fix', 'review']);
    expect(r.steps.fix.ran).toBe(true);
    expect(r.steps.review.ran).toBe(true);
    expect(r.skipped).toEqual([]);
  });

  it('skips a step whose only parent was skipped (cascade)', async () => {
    // plan fails → code's edge (success) not met → code skipped → review & fix skipped
    const { runner } = presetRunner({ plan: 'failure' });
    const r = await runWorkflow(branching, runner);
    expect(r.completed).toEqual(['plan']);
    expect(r.skipped.sort()).toEqual(['code', 'fix', 'review']);
  });
});

describe('runWorkflow — execution mechanics', () => {
  it('passes prior step results to the runner via ctx', async () => {
    let seen: Record<string, unknown> = {};
    const runner: WorkflowStepRunner = (step, ctx) => {
      if (step.id === 'review') seen = ctx.results;
      return { status: 'success', output: `${step.id}!` };
    };
    await runWorkflow(branching, runner);
    expect(seen).toMatchObject({ plan: { output: 'plan!' }, code: { output: 'code!' } });
    expect(seen).not.toHaveProperty('fix'); // skipped → not in results
  });

  it('runs steps in the same level concurrently', async () => {
    const def: WorkflowDefinition = {
      name: 'fan',
      steps: [
        { id: 'a', agentRole: 'x' },
        { id: 'b', agentRole: 'x' },
      ],
      edges: [],
    };
    let active = 0;
    let maxActive = 0;
    const runner: WorkflowStepRunner = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { status: 'success' };
    };
    await runWorkflow(def, runner);
    expect(maxActive).toBe(2); // both ran at once
  });

  it('treats a thrown runner as a failure outcome (routing the failure edge)', async () => {
    const runner: WorkflowStepRunner = (step) => {
      if (step.id === 'code') throw new Error('compile blew up');
      return { status: 'success' };
    };
    const r = await runWorkflow(branching, runner);
    expect(r.steps.code).toMatchObject({ ran: true, status: 'failure', error: 'compile blew up' });
    expect(r.steps.fix.ran).toBe(true); // failure edge taken
  });
});
