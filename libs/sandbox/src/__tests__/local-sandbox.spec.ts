import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalSandboxProvider } from '../local-sandbox';
import { SandboxPathError } from '../sandbox';

describe('LocalSandboxProvider', () => {
  let baseDir: string;
  let provider: LocalSandboxProvider;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'helix-sbx-test-'));
    provider = new LocalSandboxProvider({ baseDir });
  });

  afterEach(async () => {
    await provider.disposeAll();
    await rm(baseDir, { recursive: true, force: true });
  });

  it('provisions an existing, isolated workspace under the base dir', async () => {
    const sb = await provider.provision({ label: 'task-1' });
    expect(sb.id).toMatch(/^sbx-/);
    expect(sb.label).toBe('task-1');
    expect(sb.rootDir.startsWith(baseDir)).toBe(true);
    expect(sb.status()).toBe('active');
    expect((await stat(sb.rootDir)).isDirectory()).toBe(true);
  });

  it('gives each sandbox a distinct id + directory and tracks them', async () => {
    const a = await provider.provision();
    const b = await provider.provision();
    expect(a.id).not.toBe(b.id);
    expect(a.rootDir).not.toBe(b.rootDir);
    expect(provider.list().map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('resolve() maps paths inside the workspace and blocks escapes', async () => {
    const sb = await provider.provision();
    expect(sb.resolve('src/index.ts')).toBe(join(sb.rootDir, 'src/index.ts'));
    expect(sb.resolve('.')).toBe(sb.rootDir);
    expect(() => sb.resolve('../escape')).toThrow(SandboxPathError);
    expect(() => sb.resolve('/etc/passwd')).toThrow(SandboxPathError);
  });

  it('allows writing a file within the resolved workspace', async () => {
    const sb = await provider.provision();
    const path = sb.resolve('hello.txt');
    await writeFile(path, 'hi');
    expect((await stat(path)).isFile()).toBe(true);
  });

  it('dispose() removes the workspace, is idempotent, and untracks it', async () => {
    const sb = await provider.provision();
    const root = sb.rootDir;
    await sb.dispose();
    expect(sb.status()).toBe('disposed');
    await expect(stat(root)).rejects.toThrow(); // directory is gone
    await expect(sb.dispose()).resolves.toBeUndefined(); // idempotent
    expect(provider.list()).toHaveLength(0);
  });

  it('disposeAll() cleans every active sandbox', async () => {
    await provider.provision();
    await provider.provision();
    expect(provider.list()).toHaveLength(2);
    await provider.disposeAll();
    expect(provider.list()).toHaveLength(0);
  });
});
