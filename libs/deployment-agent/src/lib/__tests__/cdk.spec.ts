import type { CommandRunner, ExecResult, RunOptions } from '@helix/sandbox';
import {
  DeploySpec,
  cdkDeployCommand,
  cdkSynthCommand,
  extractLiveUrl,
  runCdkDeploy,
  synthesizeCdkApp,
} from '../cdk';

const ecsSpec: DeploySpec = {
  appName: 'helix-demo',
  image: '123456789012.dkr.ecr.eu-west-1.amazonaws.com/helix/demo-app:latest',
  kind: 'ecs',
  region: 'eu-west-1',
  account: '123456789012',
  env: { NODE_ENV: 'production' },
};

const fileMap = (spec: DeploySpec) => new Map(synthesizeCdkApp(spec).map((f) => [f.path, f.content]));

describe('synthesizeCdkApp — ECS', () => {
  it('emits cdk.json, the bin entrypoint, and an ALB Fargate stack fronting the image', () => {
    const files = fileMap(ecsSpec);

    expect([...files.keys()]).toEqual(['cdk.json', 'bin/app.ts', 'lib/helix-demo-stack.ts']);
    expect(files.get('cdk.json')).toContain('npx ts-node --prefer-ts-exts bin/app.ts');

    const bin = files.get('bin/app.ts')!;
    expect(bin).toContain("import { HelixDemoStack } from '../lib/helix-demo-stack'");
    expect(bin).toContain('new HelixDemoStack(app, "helix-demo"');
    expect(bin).toContain('account: "123456789012", region: "eu-west-1"');

    const stack = files.get('lib/helix-demo-stack.ts')!;
    expect(stack).toContain('class HelixDemoStack extends cdk.Stack');
    expect(stack).toContain('ApplicationLoadBalancedFargateService');
    expect(stack).toContain('ecs.ContainerImage.fromRegistry("123456789012.dkr.ecr.eu-west-1.amazonaws.com/helix/demo-app:latest")');
    expect(stack).toContain('containerPort: 8080');
    expect(stack).toContain('environment: { "NODE_ENV": "production" }');
    expect(stack).toContain("new cdk.CfnOutput(this, 'LiveUrl'");
  });

  it('honours custom port / cpu / memory / desiredCount', () => {
    const stack = fileMap({ ...ecsSpec, port: 3000, cpu: 512, memoryMiB: 1024, desiredCount: 3 }).get(
      'lib/helix-demo-stack.ts',
    )!;
    expect(stack).toContain('cpu: 512');
    expect(stack).toContain('memoryLimitMiB: 1024');
    expect(stack).toContain('desiredCount: 3');
    expect(stack).toContain('containerPort: 3000');
  });

  it('omits the region-only env account when not given', () => {
    const bin = fileMap({ ...ecsSpec, account: undefined }).get('bin/app.ts')!;
    expect(bin).toContain('env: { region: "eu-west-1" }');
    expect(bin).not.toContain('account:');
  });
});

describe('synthesizeCdkApp — Lambda', () => {
  it('emits a DockerImageFunction from ECR with a Function URL', () => {
    const stack = fileMap({ ...ecsSpec, kind: 'lambda' }).get('lib/helix-demo-stack.ts')!;

    expect(stack).toContain('lambda.DockerImageFunction');
    expect(stack).toContain("ecr.Repository.fromRepositoryName(this, 'Repo', \"helix/demo-app\")");
    expect(stack).toContain('lambda.DockerImageCode.fromEcr(repository, { tagOrDigest: "latest" })');
    expect(stack).toContain('fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE })');
    expect(stack).toContain('environment: { "NODE_ENV": "production" }');
    expect(stack).toContain("new cdk.CfnOutput(this, 'LiveUrl', { value: fnUrl.url })");
  });
});

describe('synthesizeCdkApp — validation', () => {
  it('rejects empty fields, bad kind, and out-of-range port', () => {
    expect(() => synthesizeCdkApp({ ...ecsSpec, appName: '  ' })).toThrow(/appName/);
    expect(() => synthesizeCdkApp({ ...ecsSpec, image: '' })).toThrow(/image/);
    expect(() => synthesizeCdkApp({ ...ecsSpec, region: '' })).toThrow(/region/);
    expect(() => synthesizeCdkApp({ ...ecsSpec, kind: 'fargate' as never })).toThrow(/kind/);
    expect(() => synthesizeCdkApp({ ...ecsSpec, port: 70000 })).toThrow(/port/);
  });
});

describe('cdk commands + live-url parsing', () => {
  it('builds the synth and deploy commands', () => {
    expect(cdkSynthCommand()).toEqual({ command: 'npx', args: ['cdk', 'synth'] });
    expect(cdkDeployCommand()).toEqual({
      command: 'npx',
      args: ['cdk', 'deploy', '--require-approval', 'never'],
    });
    expect(cdkDeployCommand({ requireApprovalNever: false })).toEqual({
      command: 'npx',
      args: ['cdk', 'deploy'],
    });
  });

  it('extracts the LiveUrl output from deploy stdout', () => {
    const stdout = [
      'helix-demo: deploying...',
      'Outputs:',
      'helix-demo.LiveUrl = http://helix-demo-1234.eu-west-1.elb.amazonaws.com',
    ].join('\n');
    expect(extractLiveUrl(stdout)).toBe('http://helix-demo-1234.eu-west-1.elb.amazonaws.com');
    expect(extractLiveUrl('no outputs here')).toBeUndefined();
  });
});

function fakeRunner(
  result: Partial<ExecResult>,
  onRun?: (command: string, options?: RunOptions) => void,
): CommandRunner {
  return {
    async run(command: string, options: RunOptions = {}): Promise<ExecResult> {
      onRun?.(command, options);
      return {
        command: [command, ...(options.args ?? [])].join(' '),
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
        durationMs: 1,
        ...result,
      };
    },
  };
}

describe('runCdkDeploy', () => {
  it('runs cdk deploy, reports ok and the parsed live URL, passing cwd/timeout', async () => {
    let seen: RunOptions | undefined;
    const runner = fakeRunner(
      { exitCode: 0, stdout: 'Outputs:\nhelix-demo.LiveUrl = https://abc.lambda-url.eu-west-1.on.aws/' },
      (_c, options) => (seen = options),
    );

    const result = await runCdkDeploy(runner, { cwd: 'cdk-app', timeoutMs: 900_000 });

    expect(result.ok).toBe(true);
    expect(result.liveUrl).toBe('https://abc.lambda-url.eu-west-1.on.aws/');
    expect(result.command).toBe('npx cdk deploy --require-approval never');
    expect(seen).toMatchObject({ cwd: 'cdk-app', timeoutMs: 900_000 });
  });

  it('reports not-ok and no URL on a non-zero exit', async () => {
    const result = await runCdkDeploy(fakeRunner({ exitCode: 1, stderr: 'deploy failed' }));
    expect(result.ok).toBe(false);
    expect(result.liveUrl).toBeUndefined();
    expect(result.exitCode).toBe(1);
  });

  it('reports not-ok on timeout', async () => {
    const result = await runCdkDeploy(fakeRunner({ exitCode: null, timedOut: true }));
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  });
});
