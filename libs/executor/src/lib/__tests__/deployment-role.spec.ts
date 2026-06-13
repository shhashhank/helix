import { type ExecutableStep, RoleDispatcher } from '../executor';
import type { RunContext } from '../role-executor';
import { type DeploymentRunner, deploymentExecutor, registerDeploymentRole } from '../deployment-role';

const step = (over: Partial<ExecutableStep> = {}): ExecutableStep => ({ id: 'deploy', agentRole: 'deployment', ...over });
const ctx = (results: RunContext['results'] = {}): RunContext => ({ results });

describe('deploymentExecutor', () => {
  it('maps a successful deploy to success with the live URL artifact', async () => {
    const runner: DeploymentRunner = { deploy: jest.fn(async () => ({ ok: true, liveUrl: 'https://app.example.com', environment: 'staging' })) };
    const result = await deploymentExecutor({ runner })(step(), ctx({ test: { status: 'success' } }));

    expect(result).toEqual({ status: 'success', output: { liveUrl: 'https://app.example.com', environment: 'staging' } });
  });

  it('passes the step + context to the runner', async () => {
    const deploy = jest.fn(async () => ({ ok: true, liveUrl: 'https://x' }));
    const runner: DeploymentRunner = { deploy };
    const s = step();
    const c = ctx({ code: { status: 'success', output: 'built' } });

    await deploymentExecutor({ runner })(s, c);
    expect(deploy).toHaveBeenCalledWith({ step: s, ctx: c });
  });

  it('maps a failed deploy to failure with the error', async () => {
    const runner: DeploymentRunner = { deploy: jest.fn(async () => ({ ok: false, error: 'CDK deploy failed' })) };
    const result = await deploymentExecutor({ runner })(step(), ctx());
    expect(result).toEqual({ status: 'failure', error: 'CDK deploy failed' });
  });

  it('registerDeploymentRole registers the deployment role', async () => {
    const runner: DeploymentRunner = { deploy: jest.fn(async () => ({ ok: true, liveUrl: 'https://live' })) };
    const dispatcher = registerDeploymentRole(new RoleDispatcher<RunContext>(), { runner });

    expect(dispatcher.has('deployment')).toBe(true);
    const result = await dispatcher.run(step(), ctx());
    expect((result.output as { liveUrl: string }).liveUrl).toBe('https://live');
  });
});
