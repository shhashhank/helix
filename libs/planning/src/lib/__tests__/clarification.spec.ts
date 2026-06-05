import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmContentPart,
  LlmProvider,
} from '@helix/llm';
import {
  ClarificationGenerationError,
  ClarificationQuestion,
  ClarificationValidationError,
  CLARIFICATIONS_TOOL_NAME,
  generateClarifications,
  hasBlockingQuestions,
  openQuestionsToClarifications,
  parseClarificationSet,
  triageByConfidence,
} from '../clarification';
import { RequirementsSpec } from '../requirements';

const spec: RequirementsSpec = {
  title: 'Notes API',
  summary: 'A small REST API to create and list notes.',
  goals: ['Persist notes'],
  functionalRequirements: [{ id: 'FR-1', description: 'Create a note', priority: 'must' }],
  nonFunctionalRequirements: [],
  constraints: [],
  assumptions: ['Single tenant'],
  outOfScope: ['Auth'],
  openQuestions: ['Should notes be private to the creator?', 'Is there a max note size?'],
  acceptanceCriteria: ['POST then GET returns the created note'],
};

const question = (over: Partial<ClarificationQuestion>): ClarificationQuestion => ({
  id: 'CQ-1',
  topic: 'auth',
  question: 'Should notes be private to the creating user?',
  importance: 'important',
  confidence: 0.4,
  ...over,
});

function fakeLlm(
  content: LlmContentPart[],
  onRequest?: (r: LlmCompletionRequest) => void,
): LlmProvider {
  return {
    name: 'fake',
    async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
      onRequest?.(request);
      return {
        model: 'claude-opus-4-8',
        stopReason: 'tool_use',
        content,
        text: '',
        usage: { inputTokens: 5, outputTokens: 8, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      };
    },
    async *stream() {
      throw new Error('unused');
    },
  };
}

const toolUse = (input: unknown): LlmContentPart => ({
  type: 'tool_use',
  id: 'tu_1',
  name: CLARIFICATIONS_TOOL_NAME,
  input,
});

describe('parseClarificationSet', () => {
  it('accepts a valid set and returns the questions', () => {
    expect(parseClarificationSet({ questions: [question({})] })).toEqual([question({})]);
  });

  it('accepts an empty list', () => {
    expect(parseClarificationSet({ questions: [] })).toEqual([]);
  });

  it('rejects an invalid importance', () => {
    expect(() => parseClarificationSet({ questions: [question({ importance: 'urgent' as never })] })).toThrow(
      ClarificationValidationError,
    );
  });

  it('rejects a confidence outside 0–1', () => {
    expect(() => parseClarificationSet({ questions: [question({ confidence: 1.5 })] })).toThrow(
      ClarificationValidationError,
    );
  });
});

describe('generateClarifications', () => {
  it('forces the clarification tool, embeds the spec, and returns parsed questions', async () => {
    let seen: LlmCompletionRequest | undefined;
    const questions = [question({ id: 'CQ-1' }), question({ id: 'CQ-2', importance: 'optional', confidence: 0.9 })];
    const llm = fakeLlm([toolUse({ questions })], (r) => (seen = r));

    const result = await generateClarifications(spec, llm, { requestText: 'build a notes api' });

    expect(result.questions).toEqual(questions);
    expect(result.usage.outputTokens).toBe(8);
    expect(seen?.toolChoice).toEqual({ name: CLARIFICATIONS_TOOL_NAME });
    expect(seen?.system).toMatch(/ambiguity/i);
    const msg = JSON.stringify(seen?.messages);
    expect(msg).toContain('Notes API'); // spec embedded
    expect(msg).toContain('build a notes api'); // original request embedded
  });

  it('allows an empty questions list (spec already clear)', async () => {
    const llm = fakeLlm([toolUse({ questions: [] })]);
    expect((await generateClarifications(spec, llm)).questions).toEqual([]);
  });

  it('throws when the model returns no tool call', async () => {
    const llm = fakeLlm([{ type: 'text', text: 'looks fine to me' }]);
    await expect(generateClarifications(spec, llm)).rejects.toBeInstanceOf(ClarificationGenerationError);
  });

  it('propagates a validation error for malformed tool output', async () => {
    const llm = fakeLlm([toolUse({ questions: [{ id: 'CQ-1' }] })]);
    await expect(generateClarifications(spec, llm)).rejects.toBeInstanceOf(ClarificationValidationError);
  });
});

describe('triageByConfidence', () => {
  it('asks low-confidence and blocking questions; auto-resolves confident ones', () => {
    const questions = [
      question({ id: 'CQ-low', confidence: 0.3, importance: 'important' }),
      question({ id: 'CQ-high', confidence: 0.95, importance: 'optional' }),
      question({ id: 'CQ-block', confidence: 0.99, importance: 'blocking' }),
    ];
    const { toAsk, autoResolved } = triageByConfidence(questions, 0.7);
    expect(toAsk.map((q) => q.id).sort()).toEqual(['CQ-block', 'CQ-low']);
    expect(autoResolved.map((q) => q.id)).toEqual(['CQ-high']);
  });
});

describe('openQuestionsToClarifications + hasBlockingQuestions', () => {
  it('maps the spec openQuestions into structured, zero-confidence questions', () => {
    const qs = openQuestionsToClarifications(spec);
    expect(qs).toHaveLength(2);
    expect(qs[0]).toMatchObject({ id: 'Q-1', confidence: 0, importance: 'important' });
    expect(qs[1].question).toBe('Is there a max note size?');
  });

  it('detects blocking questions', () => {
    expect(hasBlockingQuestions([question({ importance: 'optional' })])).toBe(false);
    expect(hasBlockingQuestions([question({ importance: 'blocking' })])).toBe(true);
  });
});
