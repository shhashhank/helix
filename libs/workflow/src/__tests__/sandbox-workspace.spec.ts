import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCall } from '@helix/agent';
import type { WorkspaceDiff } from '@helix/coding-agent';
import { type ExecutableStep, RunScopedWorkspaceProvider } from '@helix/executor';
import { LocalSandboxProvider } from '@helix/sandbox';
import { createSandboxWorkspace, populateSpecFromConfig } from '../lib/sandbox-workspace';

const call = (name: string, input: unknown): ToolCall => ({ id: `t-${name}`, name, input });
const step = (over: Partial<ExecutableStep> = {}): ExecutableStep => ({ id: 's', agentRole: 'coding', ...over });

describe('createSandboxWorkspace (HELIX-165 worker wiring)', () => {
  let baseDir: string;
  let sandboxes: LocalSandboxProvider;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'helix-sbx-ws-'));
    sandboxes = new LocalSandboxProvider({ baseDir });
  });

  afterEach(async () => {
    await sandboxes.disposeAll();
    await rm(baseDir, { recursive: true, force: true });
  });

  it('provisions + scaffolds a run workspace and binds coding tools to it', async () => {
    const { factory, tools } = createSandboxWorkspace({ sandboxes });
    const provider = new RunScopedWorkspaceProvider(factory);

    const ws = await provider.acquire('run-1', step({ id: 'code', agentRole: 'coding' }));
    expect(await readFile(join(ws.dir, 'package.json'), 'utf8')).toContain('helix-app'); // scaffold seeded it

    const coding = tools.toolsFor('coding', ws);
    expect(Object.keys(coding).sort()).toEqual(['patch_file', 'read_file', 'write_file']);

    await coding.write_file(call('write_file', { path: 'src/x.ts', content: 'export const x = 1;\n' }));
    expect(await readFile(join(ws.dir, 'src/x.ts'), 'utf8')).toBe('export const x = 1;\n'); // landed in this run's sandbox
  });

  it('shares one sandbox across a run — testing sees the file coding wrote', async () => {
    const { factory, tools } = createSandboxWorkspace({ sandboxes });
    const provider = new RunScopedWorkspaceProvider(factory);

    const ws1 = await provider.acquire('run-1', step({ id: 'code', agentRole: 'coding' }));
    await tools.toolsFor('coding', ws1).write_file(call('write_file', { path: 'made.ts', content: 'ok\n' }));

    const ws2 = await provider.acquire('run-1', step({ id: 'test', agentRole: 'testing' }));
    expect(ws2).toBe(ws1); // same run → same sandbox

    const testing = tools.toolsFor('testing', ws2);
    expect(Object.keys(testing).sort()).toEqual(['run_command', 'run_tests']);

    const read = await tools.toolsFor('coding', ws2).read_file(call('read_file', { path: 'made.ts' }));
    expect(read).toEqual({ content: 'ok\n' });
  });

  it('gives non-sandbox roles no tools, and an unknown workspace no tools', async () => {
    const { factory, tools } = createSandboxWorkspace({ sandboxes });
    const provider = new RunScopedWorkspaceProvider(factory);
    const ws = await provider.acquire('run-1', step());

    expect(tools.toolsFor('planning', ws)).toEqual({});
    expect(tools.toolsFor('coding', { id: 'unknown', dir: '/tmp/nope' })).toEqual({});
  });

  it('captures the change set and disposes the sandbox on release', async () => {
    const changeSets: { id: string; diff: WorkspaceDiff }[] = [];
    const { factory, tools } = createSandboxWorkspace({
      sandboxes,
      onChangeSet: (id, diff) => changeSets.push({ id, diff }),
    });
    const provider = new RunScopedWorkspaceProvider(factory);

    const ws = await provider.acquire('run-1', step());
    await tools.toolsFor('coding', ws).write_file(call('write_file', { path: 'src/new.ts', content: 'new\n' }));
    await provider.release('run-1');

    expect(changeSets).toHaveLength(1);
    expect(changeSets[0].id).toBe(ws.id);
    const added = changeSets[0].diff.changes.filter((c) => c.status === 'added').map((c) => c.path);
    expect(added).toContain('src/new.ts'); // an addition over the scaffold baseline
    expect(sandboxes.list()).toHaveLength(0); // sandbox disposed
  });

  it('populateSpecFromConfig prefers an explicit scaffold from config, else the default', () => {
    const custom = populateSpecFromConfig(step({ config: { scaffold: [{ path: 'a.ts', content: 'x' }] } }));
    expect(custom).toMatchObject({ kind: 'scaffold', files: [{ path: 'a.ts', content: 'x' }] });

    const fallback = populateSpecFromConfig(step());
    expect(fallback.kind).toBe('scaffold');
    if (fallback.kind === 'scaffold') {
      expect(fallback.files.some((f) => f.path === 'package.json')).toBe(true);
    }
  });
});
