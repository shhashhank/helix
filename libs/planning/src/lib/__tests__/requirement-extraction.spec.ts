import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmContentPart,
  LlmProvider,
} from '@helix/llm';
import {
  extractRequirements,
  REQUIREMENTS_TOOL_NAME,
  RequirementExtractionError,
} from '../requirement-extraction';
import { RequirementsSpec, RequirementsValidationError } from '../requirements';

const spec: RequirementsSpec = {
  title: 'Notes API',
  summary: 'A small REST API to create and list notes.',
  goals: ['Persist notes', 'List notes'],
  functionalRequirements: [{ id: 'FR-1', description: 'Create a note', priority: 'must' }],
  nonFunctionalRequirements: [],
  constraints: [],
  assumptions: ['Single tenant'],
  outOfScope: ['Auth'],
  openQuestions: [],
  acceptanceCriteria: ['POST then GET returns the created note'],
};

/** A fake provider that returns `content` and records the request it received. */
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
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        },
      };
    },
    async *stream() {
      throw new Error('stream not used in extraction');
    },
  };
}

const toolUse = (input: unknown): LlmContentPart => ({
  type: 'tool_use',
  id: 'tu_1',
  name: REQUIREMENTS_TOOL_NAME,
  input,
});

describe('extractRequirements', () => {
  it('forces the spec tool and returns the validated spec + usage', async () => {
    let seen: LlmCompletionRequest | undefined;
    const llm = fakeLlm([toolUse(spec)], (r) => (seen = r));

    const result = await extractRequirements('Build a notes API', llm);

    expect(result.spec).toEqual(spec);
    expect(result.model).toBe('claude-opus-4-8');
    expect(result.usage.outputTokens).toBe(20);

    // request shape: the spec tool is offered and forced, default tier opus, request embedded
    expect(seen?.tier).toBe('opus');
    expect(seen?.tools?.map((t) => t.name)).toContain(REQUIREMENTS_TOOL_NAME);
    expect(seen?.toolChoice).toEqual({ name: REQUIREMENTS_TOOL_NAME });
    expect(seen?.system).toMatch(/requirements analyst/i);
    expect(JSON.stringify(seen?.messages)).toContain('Build a notes API');
  });

  it('passes through tier, effort, and metering context', async () => {
    let seen: LlmCompletionRequest | undefined;
    const llm = fakeLlm([toolUse(spec)], (r) => (seen = r));
    await extractRequirements('x', llm, {
      tier: 'sonnet',
      effort: 'high',
      context: { runId: 'run-1' },
    });
    expect(seen?.tier).toBe('sonnet');
    expect(seen?.effort).toBe('high');
    expect(seen?.context).toEqual({ runId: 'run-1' });
  });

  it('throws RequirementExtractionError when the model returns no tool call', async () => {
    const llm = fakeLlm([{ type: 'text', text: 'here are the requirements...' }]);
    await expect(extractRequirements('Build something', llm)).rejects.toBeInstanceOf(
      RequirementExtractionError,
    );
  });

  it('propagates RequirementsValidationError for a malformed tool input', async () => {
    const llm = fakeLlm([toolUse({ title: 'incomplete' })]);
    await expect(extractRequirements('Build something', llm)).rejects.toBeInstanceOf(
      RequirementsValidationError,
    );
  });

  it('rejects an empty request without calling the model', async () => {
    let called = false;
    const llm = fakeLlm([toolUse(spec)], () => (called = true));
    await expect(extractRequirements('   ', llm)).rejects.toBeInstanceOf(RequirementExtractionError);
    expect(called).toBe(false);
  });
});
