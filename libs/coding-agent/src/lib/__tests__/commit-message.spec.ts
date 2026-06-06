import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmContentPart,
  LlmProvider,
} from '@helix/llm';
import { CommitGroup } from '../commit-grouping';
import { FileChange } from '../diff';
import {
  buildCommitMessage,
  COMMIT_MESSAGE_TOOL_NAME,
  generateCommitMessage,
} from '../commit-message';

const change = (path: string, over: Partial<FileChange> = {}): FileChange => ({
  path,
  status: 'added',
  additions: 5,
  deletions: 0,
  diff: `+ ${path}`,
  ...over,
});

const group = (key: string, changes: FileChange[]): CommitGroup => ({
  key,
  changes,
  additions: changes.reduce((s, c) => s + c.additions, 0),
  deletions: changes.reduce((s, c) => s + c.deletions, 0),
});

describe('buildCommitMessage', () => {
  it('builds a feat with the module scope and a file body', () => {
    const msg = buildCommitMessage(
      group('src/note', [change('src/note/note.module.ts'), change('src/note/note.service.ts')]),
    );
    expect(msg.type).toBe('feat');
    expect(msg.scope).toBe('note');
    expect(msg.text).toMatch(/^feat\(note\): add note/);
    expect(msg.body).toContain('- added src/note/note.service.ts (+5/-0)');
  });

  it('infers test/docs/chore from the changed paths', () => {
    expect(buildCommitMessage(group('src/note', [change('src/note/__tests__/x.spec.ts')])).type).toBe(
      'test',
    );
    expect(buildCommitMessage(group('docs', [change('docs/guide.md')])).type).toBe('docs');
    expect(
      buildCommitMessage(group('src/note', [change('src/note/a.ts', { status: 'modified' })])).type,
    ).toBe('chore');
  });

  it('omits the scope for root files and can omit the body', () => {
    const msg = buildCommitMessage(group('(root)', [change('package.json')]), { includeBody: false });
    expect(msg.scope).toBeUndefined();
    expect(msg.text).toBe('feat: add 1 file');
    expect(msg.body).toBeUndefined();
  });
});

function fakeLlm(content: LlmContentPart[], onRequest?: (r: LlmCompletionRequest) => void): LlmProvider {
  return {
    name: 'fake',
    async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
      onRequest?.(request);
      return {
        model: 'claude-opus-4-8',
        stopReason: 'tool_use',
        content,
        text: '',
        usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      };
    },
    async *stream() {
      throw new Error('unused');
    },
  };
}

const tool = (input: unknown): LlmContentPart => ({
  type: 'tool_use',
  id: 't',
  name: COMMIT_MESSAGE_TOOL_NAME,
  input,
});

describe('generateCommitMessage', () => {
  const g = group('src/note', [change('src/note/note.service.ts')]);

  it('uses the model output when valid, forcing the tool + embedding the changes', async () => {
    let seen: LlmCompletionRequest | undefined;
    const llm = fakeLlm(
      [tool({ type: 'feat', scope: 'note', subject: 'add notes CRUD service', body: 'In-memory store.' })],
      (r) => (seen = r),
    );
    const msg = await generateCommitMessage(g, llm);
    expect(msg.text).toBe('feat(note): add notes CRUD service\n\nIn-memory store.');
    expect(seen?.toolChoice).toEqual({ name: COMMIT_MESSAGE_TOOL_NAME });
    expect(JSON.stringify(seen?.messages)).toContain('src/note/note.service.ts');
  });

  it('falls back to the deterministic builder when the model returns no tool call', async () => {
    const msg = await generateCommitMessage(g, fakeLlm([{ type: 'text', text: 'feat: ...' }]));
    expect(msg.type).toBe('feat');
    expect(msg.scope).toBe('note'); // deterministic fallback
  });

  it('falls back on invalid tool output', async () => {
    const msg = await generateCommitMessage(g, fakeLlm([tool({ type: 'nope', subject: '' })]));
    expect(msg.text).toMatch(/^feat\(note\):/);
  });

  it('falls back when the provider throws', async () => {
    const throwing: LlmProvider = {
      name: 'boom',
      async complete() {
        throw new Error('network down');
      },
      async *stream() {
        throw new Error('unused');
      },
    };
    const msg = await generateCommitMessage(g, throwing);
    expect(msg.scope).toBe('note');
  });
});
