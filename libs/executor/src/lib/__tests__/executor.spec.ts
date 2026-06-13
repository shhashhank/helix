import { type ExecutableStep, RoleDispatcher, simulatedStepExecutor, type StepExecutor } from '../executor';

const step = (over: Partial<ExecutableStep> = {}): ExecutableStep => ({ id: 's1', agentRole: 'coding', ...over });

describe('RoleDispatcher', () => {
  it('routes a step to the executor registered for its agentRole', async () => {
    const coding: StepExecutor = jest.fn(async () => ({ status: 'success' as const, output: 'coded' }));
    const planning: StepExecutor = jest.fn(async () => ({ status: 'success' as const, output: 'planned' }));
    const dispatcher = new RoleDispatcher().register('coding', coding).register('planning', planning);

    expect(await dispatcher.run(step({ agentRole: 'planning' }), {})).toEqual({ status: 'success', output: 'planned' });
    expect(planning).toHaveBeenCalledTimes(1);
    expect(coding).not.toHaveBeenCalled();
  });

  it('passes the step and context through to the chosen executor', async () => {
    const exec = jest.fn(async () => ({ status: 'success' as const }));
    const dispatcher = new RoleDispatcher().register('coding', exec);
    const ctx = { results: { plan: { status: 'success' } } };
    const s = step();

    await dispatcher.run(s, ctx);
    expect(exec).toHaveBeenCalledWith(s, ctx);
  });

  it('fails the step (business failure, not thrown) for an unregistered role with no fallback', async () => {
    const dispatcher = new RoleDispatcher().register('coding', async () => ({ status: 'success' }));
    const result = await dispatcher.run(step({ agentRole: 'mystery' }), {});
    expect(result.status).toBe('failure');
    expect(result.error).toMatch(/no executor registered for agent role "mystery"/);
  });

  it('uses the fallback executor for unregistered roles when provided', async () => {
    const fallback: StepExecutor = jest.fn(async () => ({ status: 'success' as const, output: 'fallback' }));
    const dispatcher = new RoleDispatcher(fallback).register('coding', async () => ({ status: 'success', output: 'real' }));

    expect(await dispatcher.run(step({ agentRole: 'coding' }), {})).toEqual({ status: 'success', output: 'real' });
    expect(await dispatcher.run(step({ agentRole: 'anything' }), {})).toEqual({ status: 'success', output: 'fallback' });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('reports role registration via has(), latest registration wins', async () => {
    const dispatcher = new RoleDispatcher();
    expect(dispatcher.has('coding')).toBe(false);
    dispatcher.register('coding', async () => ({ status: 'failure' }));
    dispatcher.register('coding', async () => ({ status: 'success', output: 'v2' }));
    expect(dispatcher.has('coding')).toBe(true);
    expect(await dispatcher.run(step(), {})).toEqual({ status: 'success', output: 'v2' });
  });
});

describe('simulatedStepExecutor', () => {
  it('succeeds with a placeholder output', async () => {
    expect(await simulatedStepExecutor()(step({ id: 'plan' }), {})).toEqual({ status: 'success', output: 'plan output' });
  });

  it('fails the step when config.fail is set', async () => {
    expect(await simulatedStepExecutor()(step({ id: 'code', config: { fail: true } }), {})).toEqual({
      status: 'failure',
      error: 'code failed',
    });
  });

  it('works as a dispatcher fallback so any role simulates (preserves dev-worker behaviour)', async () => {
    const dispatcher = new RoleDispatcher(simulatedStepExecutor());
    expect((await dispatcher.run(step({ id: 'x', agentRole: 'whatever' }), {})).status).toBe('success');
  });
});
