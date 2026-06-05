import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalSandboxProvider, Sandbox } from '@helix/sandbox';
import {
  createFileEditToolHandler,
  FILE_EDIT_TOOL_NAMES,
  FILE_EDIT_TOOLS,
} from '../file-edit-tools';

describe('FILE_EDIT_TOOLS', () => {
  it('exposes read/write/patch tools with object input schemas', () => {
    expect(FILE_EDIT_TOOLS.map((t) => t.name)).toEqual(['read_file', 'write_file', 'patch_file']);
    for (const tool of FILE_EDIT_TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description).toBeTruthy();
    }
  });
});

describe('createFileEditToolHandler', () => {
  let baseDir: string;
  let provider: LocalSandboxProvider;
  let sandbox: Sandbox;
  let handle: ReturnType<typeof createFileEditToolHandler>;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'helix-fet-test-'));
    provider = new LocalSandboxProvider({ baseDir });
    sandbox = await provider.provision();
    handle = createFileEditToolHandler(sandbox);
  });

  afterEach(async () => {
    await provider.disposeAll();
    await rm(baseDir, { recursive: true, force: true });
  });

  it('round-trips write → read → patch', async () => {
    const write = await handle(FILE_EDIT_TOOL_NAMES.write, { path: 'src/x.ts', content: 'let n = 1;' });
    expect(write).toEqual({ content: 'wrote src/x.ts' });

    const read = await handle(FILE_EDIT_TOOL_NAMES.read, { path: 'src/x.ts' });
    expect(read).toEqual({ content: 'let n = 1;' });

    const patch = await handle(FILE_EDIT_TOOL_NAMES.patch, {
      path: 'src/x.ts',
      oldText: 'let n = 1;',
      newText: 'let n = 2;',
    });
    expect(patch.content).toContain('patched src/x.ts (1 replacement)');
    expect((await handle(FILE_EDIT_TOOL_NAMES.read, { path: 'src/x.ts' })).content).toBe('let n = 2;');
  });

  it('returns an isError result for an unknown tool', async () => {
    expect(await handle('frobnicate', {})).toEqual({ content: 'unknown tool: frobnicate', isError: true });
  });

  it('returns an isError result (not a throw) on a missing file', async () => {
    const r = await handle(FILE_EDIT_TOOL_NAMES.read, { path: 'missing.ts' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/file not found/);
  });

  it('returns an isError result on an un-applicable patch', async () => {
    await handle(FILE_EDIT_TOOL_NAMES.write, { path: 'f.ts', content: 'a' });
    const r = await handle(FILE_EDIT_TOOL_NAMES.patch, { path: 'f.ts', oldText: 'zzz', newText: 'b' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not found/);
  });

  it('returns an isError result on invalid input', async () => {
    const r = await handle(FILE_EDIT_TOOL_NAMES.write, { path: '' });
    expect(r.isError).toBe(true);
  });
});
