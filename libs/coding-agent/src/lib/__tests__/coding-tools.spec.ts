import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCall } from '@helix/agent';
import { LocalSandboxProvider, Sandbox } from '@helix/sandbox';
import { codingFileEditTools, codingToolDefs } from '../coding-tools';

const call = (name: string, input: unknown): ToolCall => ({ id: `t-${name}`, name, input });

describe('codingFileEditTools', () => {
  let baseDir: string;
  let provider: LocalSandboxProvider;
  let sandbox: Sandbox;
  let tools: ReturnType<typeof codingFileEditTools>;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'helix-coding-tools-'));
    provider = new LocalSandboxProvider({ baseDir });
    sandbox = await provider.provision();
    tools = codingFileEditTools(sandbox);
  });

  afterEach(async () => {
    await provider.disposeAll();
    await rm(baseDir, { recursive: true, force: true });
  });

  it('exposes one executor per file-edit tool, matching the tool defs', () => {
    expect(Object.keys(tools).sort()).toEqual(['patch_file', 'read_file', 'write_file']);
    expect(codingToolDefs.map((t) => t.name).sort()).toEqual(['patch_file', 'read_file', 'write_file']);
  });

  it('write / read / patch executors run against the bound sandbox', async () => {
    const wrote = await tools.write_file(call('write_file', { path: 'src/x.ts', content: 'let n = 1;' }));
    expect(wrote).toEqual({ content: 'wrote src/x.ts' });

    const read = await tools.read_file(call('read_file', { path: 'src/x.ts' }));
    expect(read).toEqual({ content: 'let n = 1;' });

    const patched = await tools.patch_file(
      call('patch_file', { path: 'src/x.ts', oldText: 'let n = 1;', newText: 'let n = 2;' }),
    );
    expect(patched.content).toContain('patched src/x.ts');
    expect((await tools.read_file(call('read_file', { path: 'src/x.ts' }))).content).toBe('let n = 2;');
  });

  it('the written file actually lands in the sandbox dir', async () => {
    await tools.write_file(call('write_file', { path: 'a.txt', content: 'hello' }));
    expect(await readFile(sandbox.resolve('a.txt'), 'utf8')).toBe('hello');
  });

  it('surfaces an expected failure as an isError result (no throw)', async () => {
    const missing = await tools.read_file(call('read_file', { path: 'nope.ts' }));
    expect(missing.isError).toBe(true);
    expect(missing.content).toMatch(/file not found/);
  });

  it('blocks a path that escapes the sandbox root', async () => {
    const escape = await tools.write_file(call('write_file', { path: '../escape.ts', content: 'x' }));
    expect(escape.isError).toBe(true);
    expect(escape.content).toMatch(/escape/i);
  });
});
