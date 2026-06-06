import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalSandboxProvider, Sandbox } from '@helix/sandbox';
import { readFile } from '../file-edits';
import { applyScaffold } from '../scaffold';
import { nestCrudResource } from '../templates/nest-crud';

describe('nestCrudResource', () => {
  it('generates the five CRUD files at the expected paths', () => {
    const files = nestCrudResource('note');
    expect(files.map((f) => f.path)).toEqual([
      'src/note/note.module.ts',
      'src/note/note.controller.ts',
      'src/note/note.service.ts',
      'src/note/dto/create-note.dto.ts',
      'src/note/dto/update-note.dto.ts',
    ]);
  });

  it('uses the right class names, route, and DI in the generated code', () => {
    const byPath = Object.fromEntries(nestCrudResource('note').map((f) => [f.path, f.content]));

    expect(byPath['src/note/note.module.ts']).toContain('export class NoteModule');
    expect(byPath['src/note/note.controller.ts']).toContain("@Controller('notes')");
    expect(byPath['src/note/note.controller.ts']).toContain(
      'private readonly noteService: NoteService',
    );
    expect(byPath['src/note/note.service.ts']).toContain('export class NoteService');
    expect(byPath['src/note/dto/update-note.dto.ts']).toContain(
      'extends PartialType(CreateNoteDto)',
    );
  });

  it('pluralises the controller route for multi-word resources', () => {
    const controller = nestCrudResource('note-item').find((f) =>
      f.path.endsWith('.controller.ts'),
    );
    expect(controller?.content).toContain("@Controller('note-items')");
    expect(controller?.content).toContain('NoteItemService');
  });

  it('writes a coherent resource into the sandbox', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'helix-nest-test-'));
    const provider = new LocalSandboxProvider({ baseDir });
    const sandbox: Sandbox = await provider.provision();
    try {
      const { written } = await applyScaffold(sandbox, nestCrudResource('note'));
      expect(written).toHaveLength(5);
      expect(await readFile(sandbox, 'src/note/note.module.ts')).toContain('NoteController');
    } finally {
      await provider.disposeAll();
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
