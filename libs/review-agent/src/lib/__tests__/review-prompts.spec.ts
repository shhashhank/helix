import type { LlmCompletion, LlmCompletionRequest, LlmProvider } from '@helix/llm';
import { ReviewContext } from '../review-context';
import {
  ASPECT_GUIDANCE,
  buildAspectSystemPrompt,
  REVIEW_ASPECTS,
  reviewAspect,
  reviewAspects,
} from '../review-prompts';

const context: ReviewContext = {
  files: [
    { path: 'src/note/note.service.ts', status: 'added', diff: '+ class NoteService {}', additions: 20, deletions: 0 },
  ],
  summary: { fileCount: 1, additions: 20, deletions: 0 },
  spec: 'Notes API requirements',
};

function fakeLlm(
  reply: string,
  onRequest?: (r: LlmCompletionRequest) => void,
): LlmProvider {
  return {
    name: 'fake',
    async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
      onRequest?.(request);
      return {
        model: 'claude-opus-4-8',
        stopReason: 'end_turn',
        content: [{ type: 'text', text: reply }],
        text: reply,
        usage: { inputTokens: 5, outputTokens: 9, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      };
    },
    async *stream() {
      throw new Error('unused');
    },
  };
}

describe('buildAspectSystemPrompt', () => {
  it('mentions the aspect and its guidance', () => {
    const prompt = buildAspectSystemPrompt('security');
    expect(prompt).toMatch(/security review/i);
    expect(prompt).toContain(ASPECT_GUIDANCE.security);
  });
});

describe('reviewAspect', () => {
  it('reviews with the aspect prompt + the formatted context and returns the text', async () => {
    let seen: LlmCompletionRequest | undefined;
    const llm = fakeLlm('No correctness issues found.', (r) => (seen = r));

    const result = await reviewAspect(context, 'correctness', llm, { tier: 'sonnet' });

    expect(result.aspect).toBe('correctness');
    expect(result.review).toBe('No correctness issues found.');
    expect(result.usage.outputTokens).toBe(9);
    expect(seen?.tier).toBe('sonnet');
    expect(seen?.system).toMatch(/correctness review/i);
    const msg = JSON.stringify(seen?.messages);
    expect(msg).toContain('src/note/note.service.ts'); // diff embedded
    expect(msg).toContain('Notes API requirements'); // spec embedded (for plan-conformance)
  });
});

describe('reviewAspects', () => {
  it('runs every aspect by default, in order', async () => {
    const seen: string[] = [];
    const llm = fakeLlm('ok', (r) => seen.push(r.system ?? ''));
    const reviews = await reviewAspects(context, llm);

    expect(reviews.map((r) => r.aspect)).toEqual([...REVIEW_ASPECTS]);
    expect(seen).toHaveLength(REVIEW_ASPECTS.length);
  });

  it('runs only the requested aspects', async () => {
    const llm = fakeLlm('ok');
    const reviews = await reviewAspects(context, llm, { aspects: ['security', 'performance'] });
    expect(reviews.map((r) => r.aspect)).toEqual(['security', 'performance']);
  });
});
