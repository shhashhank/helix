import { createStepActivities } from '../lib/temporal/activities';
import { WorkflowStepRunner } from '../lib/runner';

describe('createStepActivities', () => {
  it('runStep delegates to the injected executor with the step + ctx', async () => {
    const calls: { id: string; planOutput: unknown }[] = [];
    const execute: WorkflowStepRunner = (step, ctx) => {
      calls.push({ id: step.id, planOutput: ctx.results.plan?.output });
      return { status: 'success', output: `${step.id}!` };
    };
    const { runStep } = createStepActivities(execute);

    const res = await runStep({
      step: { id: 'code', agentRole: 'coding' },
      ctx: { results: { plan: { status: 'success', output: 'p' } } },
    });

    expect(res).toEqual({ status: 'success', output: 'code!' });
    expect(calls).toEqual([{ id: 'code', planOutput: 'p' }]);
  });

  it('threads the run id into the executor context when present (HELIX-161)', async () => {
    let seenRunId: string | undefined;
    const execute: WorkflowStepRunner = (step, ctx) => {
      seenRunId = ctx.runId;
      return { status: 'success', output: step.id };
    };
    const { runStep } = createStepActivities(execute);

    await runStep({ step: { id: 'code', agentRole: 'coding' }, ctx: { results: {} }, runId: 'wf-42' });
    expect(seenRunId).toBe('wf-42');
  });

  it('awaits an async executor and propagates a business failure result', async () => {
    const execute: WorkflowStepRunner = async (step) => ({ status: 'failure', error: `${step.id} broke` });
    const { runStep } = createStepActivities(execute);

    await expect(
      runStep({ step: { id: 'code', agentRole: 'coding' }, ctx: { results: {} } }),
    ).resolves.toEqual({ status: 'failure', error: 'code broke' });
  });

  it('lets a thrown executor reject (Temporal retries / surfaces it as a technical error)', async () => {
    const execute: WorkflowStepRunner = () => {
      throw new Error('boom');
    };
    const { runStep } = createStepActivities(execute);

    await expect(
      runStep({ step: { id: 'x', agentRole: 'r' }, ctx: { results: {} } }),
    ).rejects.toThrow('boom');
  });
});
