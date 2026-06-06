import { DiffFile } from '../review-context';
import { scanDiffForSecrets } from '../secret-scan';

const added = (path: string, lines: string[]): DiffFile => ({
  path,
  status: 'added',
  diff: lines.map((l) => `+${l}`).join('\n'),
  additions: lines.length,
  deletions: 0,
});

describe('scanDiffForSecrets', () => {
  it('flags common secret shapes on added lines as blocker findings', () => {
    const files: DiffFile[] = [
      added('src/config.ts', ['const ghToken = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";']),
      added('src/aws.ts', ['const key = "AKIAIOSFODNN7EXAMPLE";']),
      added('src/env.ts', ['password = "supersecret123"']),
      added('keys/app.pem', ['-----BEGIN RSA PRIVATE KEY-----']),
    ];
    const findings = scanDiffForSecrets(files);

    expect(findings).toHaveLength(4);
    expect(findings.every((f) => f.severity === 'blocker' && f.aspect === 'security')).toBe(true);
    expect(findings.map((f) => f.file)).toEqual([
      'src/config.ts',
      'src/aws.ts',
      'src/env.ts',
      'keys/app.pem',
    ]);
    expect(findings[0].message).toMatch(/GitHub token/);
    expect(findings[0].suggestion).toMatch(/secrets vault/);
  });

  it('never echoes the secret value in the finding', () => {
    const findings = scanDiffForSecrets([
      added('src/x.ts', ['const k = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";']),
    ]);
    expect(JSON.stringify(findings)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('ignores secrets on non-added (context/removed) lines', () => {
    const file: DiffFile = {
      path: 'src/x.ts',
      status: 'modified',
      // a context line and a removed line both carry a token; neither is "+"
      diff: [' const a = "AKIAIOSFODNN7EXAMPLE";', '-const b = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";'].join('\n'),
      additions: 0,
      deletions: 1,
    };
    expect(scanDiffForSecrets([file])).toEqual([]);
  });

  it('skips deleted files and clean diffs', () => {
    expect(
      scanDiffForSecrets([
        { path: 'gone.ts', status: 'deleted', diff: '-const k = "AKIAIOSFODNN7EXAMPLE";', additions: 0, deletions: 1 },
        added('src/ok.ts', ['export const answer = 42;']),
      ]),
    ).toEqual([]);
  });

  it('reports one finding per offending added line', () => {
    const findings = scanDiffForSecrets([
      added('src/x.ts', [
        'const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";',
        'const u = "AKIAIOSFODNN7EXAMPLE";',
        'const ok = true;',
      ]),
    ]);
    expect(findings).toHaveLength(2);
  });
});
