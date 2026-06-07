/**
 * IaC deploy (HELIX-126): synthesize the AWS CDK app for a single demo stack that
 * fronts the pushed ECR image — an ALB-backed **ECS Fargate** service, or a
 * **Lambda** container function with a Function URL — and run `cdk deploy`,
 * recovering the live URL the stack exports.
 *
 * `synthesizeCdkApp` (the generated CDK files) and the command builders are pure +
 * deterministic; `runCdkDeploy` executes through the injected {@link CommandRunner}.
 * The actual `cdk deploy` needs the AWS CDK CLI + real AWS credentials (not in CI),
 * so it's a deferred binding — the synthesis, command generation, and the
 * live-URL parsing are real and offline-testable.
 */
import type { CommandRunner } from '@helix/sandbox';
import type { BuildCommand, ProjectFile } from './build';

export type DeployKind = 'ecs' | 'lambda';

export interface DeploySpec {
  /** Logical app / stack name, e.g. `helix-demo`. */
  appName: string;
  /** ECR image URI to deploy (from HELIX-125), e.g. `…amazonaws.com/helix/demo-app:latest`. */
  image: string;
  /** Target compute: an ECS Fargate service or a Lambda container function. */
  kind: DeployKind;
  /** AWS region to deploy into. */
  region: string;
  /** AWS account id; optional — defaults to the CDK default account at deploy time. */
  account?: string;
  /** Container port the service listens on (ECS only; default 8080). */
  port?: number;
  /** Fargate CPU units (ECS only; default 256). */
  cpu?: number;
  /** Memory in MiB (default 512). */
  memoryMiB?: number;
  /** Number of Fargate tasks (ECS only; default 1). */
  desiredCount?: number;
  /** Environment variables to pass to the container/function. */
  env?: Record<string, string>;
}

const DEFAULTS = { port: 8080, cpu: 256, memoryMiB: 512, desiredCount: 1 } as const;

/** The CloudFormation output key the synthesized stack always exports; `runCdkDeploy` parses it. */
export const LIVE_URL_OUTPUT = 'LiveUrl';

function assertValidSpec(spec: DeploySpec): void {
  if (!spec.appName.trim()) throw new Error('Deploy spec appName is required');
  if (!spec.image.trim()) throw new Error('Deploy spec image is required');
  if (!spec.region.trim()) throw new Error('Deploy spec region is required');
  if (spec.kind !== 'ecs' && spec.kind !== 'lambda') {
    throw new Error(`Unknown deploy kind: ${JSON.stringify(spec.kind)}`);
  }
  const port = spec.port ?? DEFAULTS.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid container port: ${port}`);
  }
}

/** `helix-demo` → `HelixDemo`. */
function pascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

/** Any case → `helix-demo` (CloudFormation stack id / file slug). */
function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .join('-')
    .toLowerCase();
}

/** Split an ECR image URI into its repository name and tag (tag defaults to `latest`). */
function parseImageRef(image: string): { repository: string; tag: string } {
  const slash = image.indexOf('/');
  const rest = slash === -1 ? image : image.slice(slash + 1);
  const colon = rest.lastIndexOf(':');
  if (colon === -1) return { repository: rest, tag: 'latest' };
  return { repository: rest.slice(0, colon), tag: rest.slice(colon + 1) };
}

function renderEnv(env: Record<string, string> | undefined, indent: string): string {
  const entries = Object.entries(env ?? {});
  if (entries.length === 0) return '';
  const pairs = entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ');
  return `\n${indent}environment: { ${pairs} },`;
}

function ecsStack(spec: DeploySpec, className: string): string {
  const port = spec.port ?? DEFAULTS.port;
  const env = renderEnv(spec.env, '        ');
  return `import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';

export class ${className} extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cpu: ${spec.cpu ?? DEFAULTS.cpu},
      memoryLimitMiB: ${spec.memoryMiB ?? DEFAULTS.memoryMiB},
      desiredCount: ${spec.desiredCount ?? DEFAULTS.desiredCount},
      publicLoadBalancer: true,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(${JSON.stringify(spec.image)}),
        containerPort: ${port},${env}
      },
    });

    new cdk.CfnOutput(this, '${LIVE_URL_OUTPUT}', {
      value: \`http://\${service.loadBalancer.loadBalancerDnsName}\`,
    });
  }
}
`;
}

function lambdaStack(spec: DeploySpec, className: string): string {
  const { repository, tag } = parseImageRef(spec.image);
  const env = renderEnv(spec.env, '      ');
  return `import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export class ${className} extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const repository = ecr.Repository.fromRepositoryName(this, 'Repo', ${JSON.stringify(repository)});
    const fn = new lambda.DockerImageFunction(this, 'Function', {
      code: lambda.DockerImageCode.fromEcr(repository, { tagOrDigest: ${JSON.stringify(tag)} }),
      memorySize: ${spec.memoryMiB ?? DEFAULTS.memoryMiB},
      timeout: cdk.Duration.seconds(30),${env}
    });

    const fnUrl = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    new cdk.CfnOutput(this, '${LIVE_URL_OUTPUT}', { value: fnUrl.url });
  }
}
`;
}

function binApp(spec: DeploySpec, className: string, stackId: string): string {
  const envProps = spec.account
    ? `account: ${JSON.stringify(spec.account)}, region: ${JSON.stringify(spec.region)}`
    : `region: ${JSON.stringify(spec.region)}`;
  return `#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ${className} } from '../lib/${stackId}-stack';

const app = new cdk.App();
new ${className}(app, ${JSON.stringify(stackId)}, {
  env: { ${envProps} },
});
`;
}

/**
 * Generate the CDK app files for the spec: `cdk.json`, the `bin/app.ts` entrypoint,
 * and the `lib/<app>-stack.ts` stack (an ECS Fargate service or a Lambda container
 * function fronting the ECR image, exporting a `LiveUrl` output).
 */
export function synthesizeCdkApp(spec: DeploySpec): ProjectFile[] {
  assertValidSpec(spec);
  const className = pascalCase(spec.appName) + 'Stack';
  const stackId = kebabCase(spec.appName);
  const stack = spec.kind === 'ecs' ? ecsStack(spec, className) : lambdaStack(spec, className);

  return [
    { path: 'cdk.json', content: JSON.stringify({ app: 'npx ts-node --prefer-ts-exts bin/app.ts' }, null, 2) + '\n' },
    { path: 'bin/app.ts', content: binApp(spec, className, stackId) },
    { path: `lib/${stackId}-stack.ts`, content: stack },
  ];
}

export interface CdkCommandOptions {
  /** Pass `--require-approval never` for non-interactive deploys (default true). */
  requireApprovalNever?: boolean;
}

/** `npx cdk synth` — synthesize the CloudFormation template without deploying. */
export function cdkSynthCommand(): BuildCommand {
  return { command: 'npx', args: ['cdk', 'synth'] };
}

/** `npx cdk deploy [--require-approval never]`. */
export function cdkDeployCommand(options: CdkCommandOptions = {}): BuildCommand {
  const args = ['cdk', 'deploy'];
  if (options.requireApprovalNever ?? true) args.push('--require-approval', 'never');
  return { command: 'npx', args };
}

/** Pull the exported `LiveUrl` value out of `cdk deploy` stdout, if present. */
export function extractLiveUrl(stdout: string): string | undefined {
  const match = stdout.match(new RegExp(`${LIVE_URL_OUTPUT}\\s*=\\s*(\\S+)`));
  return match?.[1];
}

export interface DeployRunOptions extends CdkCommandOptions {
  /** Working dir of the synthesized CDK app, relative to the sandbox root. */
  cwd?: string;
  timeoutMs?: number;
}

export interface DeployResult {
  ok: boolean;
  /** The stack's live URL, parsed from the deploy output (when the deploy succeeded). */
  liveUrl?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  command: string;
}

/** Run `cdk deploy` for an already-synthesized app via the command runner, recovering the live URL. */
export async function runCdkDeploy(
  runner: CommandRunner,
  options: DeployRunOptions = {},
): Promise<DeployResult> {
  const cmd = cdkDeployCommand(options);
  const exec = await runner.run(cmd.command, {
    args: cmd.args,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
  });
  const ok = exec.exitCode === 0 && !exec.timedOut;
  return {
    ok,
    liveUrl: ok ? extractLiveUrl(exec.stdout) : undefined,
    exitCode: exec.exitCode,
    stdout: exec.stdout,
    stderr: exec.stderr,
    timedOut: exec.timedOut,
    command: exec.command,
  };
}
