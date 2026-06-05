import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmContentPart,
  LlmProvider,
} from '@helix/llm';
import { CLARIFICATIONS_TOOL_NAME, ClarificationQuestion } from '../clarification';
import {
  ClarificationResponder,
  clarifyRequirements,
  extractAndClarify,
} from '../clarification-loop';
import { REQUIREMENTS_TOOL_NAME } from '../requirement-extraction';
import { RequirementsSpec } from '../requirements';

const baseSpec: RequirementsSpec = {
  title: 'Notes API',
  summary: 'Create and list notes.',
  goals: ['Persist notes'],
  functionalRequirements: [{ id: 'FR-1', description: 'Create a note', priority: 'must' }],
  nonFunctionalRequirements: [],
  constraints: [],
  assumptions: [],
  outOfScope: [],
  openQuestions: ['Should notes be private?'],
  acceptanceCriteria: ['POST then GET returns the note'],
};

const refinedSpec: RequirementsSpec = {
  ...baseSpec,
  assumptions: ['Notes are private to their creator'],
  openQuestions: [],
};

const blockingQ: ClarificationQuestion = {
  id: 'CQ-1',
  topic: 'auth',
  question: 'Should notes be private to the creating user?',
  importance: 'blocking',
  confidence: 0.9,
  defaultAssumption: 'Private to creator',
};

const clarifications = (questions: ClarificationQuestion[]): LlmContentPart[] => [
  { type: 'tool_use', id: 'tu', name: CLARIFICATIONS_TOOL_NAME, input: { questions } },
];
const specOutput = (spec: RequirementsSpec): LlmContentPart[] => [
  { type: 'tool_use', id: 'tu', name: REQUIREMENTS_TOOL_NAME, input: spec },
];

/** A provider that returns scripted content per call, in order. */
function scriptedLlm(
  scripts: LlmContentPart[][],
  onRequest?: (req: LlmCompletionRequest, index: number) => void,
): LlmProvider {
  let i = 0;
  return {
    name: 'fake',
    async complete(req: LlmCompletionRequest): Promise<LlmCompletion> {
      const content = scripts[i] ?? [];
      onRequest?.(req, i);
      i += 1;
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

const answerAll: ClarificationResponder = async (qs) =>
  qs.map((q) => ({ id: q.id, answer: 'yes, private to creator' }));

describe('clarifyRequirements', () => {
  it('asks, refines, then stops when the spec comes back clear', async () => {
    const seen: LlmCompletionRequest[] = [];
    const llm = scriptedLlm(
      [clarifications([blockingQ]), specOutput(refinedSpec), clarifications([])],
      (r) => seen.push(r),
    );
    let asked: ClarificationQuestion[] | undefined;
    const responder: ClarificationResponder = async (qs) => {
      asked = qs;
      return answerAll(qs);
    };

    const result = await clarifyRequirements(baseSpec, llm, { responder, maxRounds: 3 });

    expect(result.spec).toEqual(refinedSpec);
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0].questionsAsked.map((q) => q.id)).toEqual(['CQ-1']);
    expect(result.rounds[0].answers).toEqual([{ id: 'CQ-1', answer: 'yes, private to creator' }]);
    expect(result.rounds[1].questionsAsked).toEqual([]);
    expect(result.usage.outputTokens).toBe(3); // 3 LLM calls
    expect(asked?.[0].id).toBe('CQ-1');
    // the refine call (index 1) embeds the answer
    expect(JSON.stringify(seen[1].messages)).toContain('yes, private to creator');
    expect(seen[1].toolChoice).toEqual({ name: REQUIREMENTS_TOOL_NAME });
  });

  it('returns immediately, without asking, when the spec is already clear', async () => {
    const responder = jest.fn(answerAll);
    const llm = scriptedLlm([clarifications([])]);
    const result = await clarifyRequirements(baseSpec, llm, { responder });
    expect(result.spec).toEqual(baseSpec);
    expect(result.rounds).toHaveLength(1);
    expect(responder).not.toHaveBeenCalled();
  });

  it('stops at maxRounds when questions keep coming', async () => {
    const llm = scriptedLlm([
      clarifications([blockingQ]),
      specOutput(refinedSpec),
      clarifications([blockingQ]),
      specOutput(refinedSpec),
    ]);
    const result = await clarifyRequirements(baseSpec, llm, { responder: answerAll, maxRounds: 2 });
    expect(result.rounds).toHaveLength(2);
  });

  it('stops without refining if the user declines to answer', async () => {
    const llm = scriptedLlm([clarifications([blockingQ])]);
    const result = await clarifyRequirements(baseSpec, llm, { responder: async () => [], maxRounds: 3 });
    expect(result.rounds).toHaveLength(1);
    expect(result.spec).toEqual(baseSpec); // no refine happened
    expect(result.usage.outputTokens).toBe(1); // only the generate call
  });
});

describe('extractAndClarify', () => {
  it('extracts a spec then runs the loop, aggregating usage', async () => {
    const responder = jest.fn(answerAll);
    const llm = scriptedLlm([specOutput(baseSpec), clarifications([])]);
    const result = await extractAndClarify('Build a notes API', llm, { responder });
    expect(result.spec).toEqual(baseSpec);
    expect(result.usage.outputTokens).toBe(2); // extract + one generate
    expect(responder).not.toHaveBeenCalled();
  });
});
