import { type ExecutableStep, RoleDispatcher } from '../executor';
import { type GitHubDeliveryRunner, deliveryExecutor, registerDeliveryRole } from '../delivery-role';
import type { RunContext } from '../role-executor';

const step: ExecutableStep = { id: 'deliver', agentRole: 'delivery' };
const ctx: RunContext = { results: {} };

describe('deliveryExecutor', () => {
  it('maps a delivered PR to a success output (the artifact shape)', async () => {
    const runner: GitHubDeliveryRunner = {
      deliver: jest.fn(async () => ({ delivered: true, pullRequest: { number: 7, url: 'https://gh/pr/7' } })),
    };
    const result = await deliveryExecutor({ runner })(step, ctx);
    expect(result).toEqual({ status: 'success', output: { pullRequest: { number: 7, url: 'https://gh/pr/7' } } });
  });

  it('treats a skip (no repo / not connected) as a benign success, not a failure', async () => {
    const runner: GitHubDeliveryRunner = {
      deliver: jest.fn(async () => ({ delivered: false, skippedReason: 'no target repo configured' })),
    };
    const result = await deliveryExecutor({ runner })(step, ctx);
    expect(result).toEqual({ status: 'success', output: { delivered: false, skippedReason: 'no target repo configured' } });
  });

  it('carries the change-set summary into the output (PR + change set as artifacts)', async () => {
    const runner: GitHubDeliveryRunner = {
      deliver: jest.fn(async () => ({
        delivered: true,
        pullRequest: { number: 9, url: 'https://gh/pr/9' },
        changeSet: { filesChanged: 3, additions: 40, deletions: 5 },
      })),
    };
    const result = await deliveryExecutor({ runner })(step, ctx);
    expect(result.output).toEqual({ pullRequest: { number: 9, url: 'https://gh/pr/9' }, changeSet: { filesChanged: 3, additions: 40, deletions: 5 } });
  });

  it('fails the step on a genuine delivery error', async () => {
    const runner: GitHubDeliveryRunner = { deliver: jest.fn(async () => ({ delivered: false, error: '422 PR already exists' })) };
    const result = await deliveryExecutor({ runner })(step, ctx);
    expect(result).toEqual({ status: 'failure', error: '422 PR already exists' });
  });

  it('registerDeliveryRole registers the delivery role on a dispatcher', async () => {
    const runner: GitHubDeliveryRunner = { deliver: jest.fn(async () => ({ delivered: true, pullRequest: { number: 1, url: 'u' } })) };
    const dispatcher = registerDeliveryRole(new RoleDispatcher<RunContext>(), { runner });
    expect(dispatcher.has('delivery')).toBe(true);
    await dispatcher.run(step, ctx);
    expect(runner.deliver).toHaveBeenCalledWith({ step, ctx });
  });
});
