import { FileChange } from '../diff';
import { defaultGroupKey, groupChanges } from '../commit-grouping';

const change = (path: string, over: Partial<FileChange> = {}): FileChange => ({
  path,
  status: 'added',
  additions: 1,
  deletions: 0,
  diff: `+${path}`,
  ...over,
});

describe('defaultGroupKey', () => {
  it('groups by the module dir, root files under (root)', () => {
    expect(defaultGroupKey('src/note/note.module.ts')).toBe('src/note');
    expect(defaultGroupKey('src/user/user.service.ts')).toBe('src/user');
    expect(defaultGroupKey('package.json')).toBe('(root)');
  });
});

describe('groupChanges', () => {
  it('groups into logical commits sorted by key, with per-group counts', () => {
    const groups = groupChanges([
      change('src/note/note.service.ts', { additions: 10 }),
      change('package.json', { additions: 2 }),
      change('src/note/note.module.ts', { additions: 5 }),
      change('src/user/user.module.ts', { additions: 7, deletions: 3 }),
    ]);

    expect(groups.map((g) => g.key)).toEqual(['(root)', 'src/note', 'src/user']);

    const note = groups.find((g) => g.key === 'src/note')!;
    expect(note.changes.map((c) => c.path)).toEqual([
      'src/note/note.module.ts',
      'src/note/note.service.ts',
    ]); // sorted by path
    expect(note.additions).toBe(15);

    const user = groups.find((g) => g.key === 'src/user')!;
    expect(user.deletions).toBe(3);
  });

  it('supports a custom key — e.g. group per task', () => {
    const byTask = new Map([
      ['src/a.ts', 'T-1'],
      ['src/b.ts', 'T-2'],
      ['src/c.ts', 'T-1'],
    ]);
    const groups = groupChanges(
      [change('src/a.ts'), change('src/b.ts'), change('src/c.ts')],
      (c) => byTask.get(c.path) ?? '(none)',
    );
    expect(groups.map((g) => g.key)).toEqual(['T-1', 'T-2']);
    expect(groups[0].changes.map((c) => c.path)).toEqual(['src/a.ts', 'src/c.ts']);
  });
});
