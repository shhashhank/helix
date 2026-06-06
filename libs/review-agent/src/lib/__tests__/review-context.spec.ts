import {
  assembleReviewContext,
  DiffFile,
  FileContentReader,
  formatReviewContext,
} from '../review-context';

const diff: DiffFile[] = [
  { path: 'src/note/note.service.ts', status: 'added', diff: '+ class NoteService {}', additions: 20, deletions: 0 },
  { path: 'src/app.module.ts', status: 'modified', diff: ' import\n+NoteModule', additions: 2, deletions: 1 },
  { path: 'src/old.ts', status: 'deleted', diff: '-gone', additions: 0, deletions: 5 },
];

function reader(byPath: Record<string, string>, seen?: string[]): FileContentReader {
  return {
    async read(path) {
      seen?.push(path);
      return byPath[path];
    },
  };
}

describe('assembleReviewContext', () => {
  it('summarises the diff and carries the spec', async () => {
    const ctx = await assembleReviewContext(diff, { spec: 'Build a notes API' });
    expect(ctx.summary).toEqual({ fileCount: 3, additions: 22, deletions: 6 });
    expect(ctx.spec).toBe('Build a notes API');
    expect(ctx.files.every((f) => f.content === undefined)).toBe(true); // no reader
  });

  it('attaches file content via the reader, but not for deleted files', async () => {
    const seen: string[] = [];
    const ctx = await assembleReviewContext(diff, {
      reader: reader(
        {
          'src/note/note.service.ts': 'export class NoteService {}',
          'src/app.module.ts': 'export class AppModule {}',
        },
        seen,
      ),
    });
    expect(ctx.files[0].content).toBe('export class NoteService {}');
    expect(ctx.files[1].content).toBe('export class AppModule {}');
    expect(ctx.files[2].content).toBeUndefined(); // deleted → not read
    expect(seen).not.toContain('src/old.ts');
  });

  it('skips content that exceeds maxFileChars', async () => {
    const big = 'x'.repeat(100);
    const ctx = await assembleReviewContext([diff[0]], {
      reader: reader({ 'src/note/note.service.ts': big }),
      maxFileChars: 50,
    });
    expect(ctx.files[0].content).toBeUndefined();
  });
});

describe('formatReviewContext', () => {
  it('renders summary, spec, diffs, and attached content', async () => {
    const ctx = await assembleReviewContext([diff[0]], {
      reader: reader({ 'src/note/note.service.ts': 'export class NoteService {}' }),
      spec: 'Notes API spec',
    });
    const block = formatReviewContext(ctx);
    expect(block).toContain('1 file(s), +20/-0');
    expect(block).toContain('<spec>\nNotes API spec\n</spec>');
    expect(block).toContain('<file path="src/note/note.service.ts" status="added">');
    expect(block).toContain('<content>\nexport class NoteService {}');
  });

  it('truncates an over-long block', async () => {
    const ctx = await assembleReviewContext([diff[0]]);
    const block = formatReviewContext(ctx, { maxChars: 20 });
    expect(block.endsWith('… (truncated)')).toBe(true);
  });
});
