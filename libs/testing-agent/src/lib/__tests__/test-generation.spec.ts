import type { LlmCompletion, LlmCompletionRequest, LlmContentPart, LlmProvider } from '@helix/llm';
import {
  buildTestGenerationSystemPrompt,
  FRAMEWORK_CONVENTIONS,
  generateTests,
  parseGeneratedTests,
  TESTS_TOOL_NAME,
  TestGenerationError,
  TestsValidationError,
} from '../test-generation';

const files = [{ path: 'src/add.ts', content: 'export const add = (a: number, b: number) => a + b;' }];

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
        usage: { inputTokens: 4, outputTokens: 8, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      };
    },
    async *stream() {
      throw new Error('unused');
    },
  };
}

const tool = (input: unknown): LlmContentPart => ({ type: 'tool_use', id: 't', name: TESTS_TOOL_NAME, input });

describe('buildTestGenerationSystemPrompt', () => {
  it('mentions the framework and its conventions', () => {
    const prompt = buildTestGenerationSystemPrompt('pytest');
    expect(prompt).toMatch(/pytest/i);
    expect(prompt).toContain(FRAMEWORK_CONVENTIONS.pytest);
  });
});

describe('parseGeneratedTests', () => {
  it('validates the test files', () => {
    expect(parseGeneratedTests({ tests: [{ path: 'a.spec.ts', content: 'it(...)' }] })).toEqual([
      { path: 'a.spec.ts', content: 'it(...)' },
    ]);
  });

  it('rejects a test missing its content', () => {
    expect(() => parseGeneratedTests({ tests: [{ path: 'a.spec.ts' }] })).toThrow(TestsValidationError);
  });
});

describe('generateTests', () => {
  it('forces the tool, embeds the source, and returns the generated tests', async () => {
    let seen: LlmCompletionRequest | undefined;
    const llm = fakeLlm(
      [tool({ tests: [{ path: 'src/add.spec.ts', content: "import { add } from './add';" }] })],
      (r) => (seen = r),
    );

    const result = await generateTests({ framework: 'jest', files }, llm);

    expect(result.tests).toEqual([{ path: 'src/add.spec.ts', content: "import { add } from './add';" }]);
    expect(result.usage.outputTokens).toBe(8);
    expect(seen?.toolChoice).toEqual({ name: TESTS_TOOL_NAME });
    expect(seen?.system).toMatch(/jest/i);
    expect(JSON.stringify(seen?.messages)).toContain('src/add.ts'); // source embedded
  });

  it('throws when the model returns no tool call', async () => {
    await expect(generateTests({ framework: 'jest', files }, fakeLlm([{ type: 'text', text: '...' }]))).rejects.toBeInstanceOf(
      TestGenerationError,
    );
  });

  it('propagates a validation error for malformed tool output', async () => {
    await expect(generateTests({ framework: 'jest', files }, fakeLlm([tool({ tests: [{ path: 'x' }] })]))).rejects.toBeInstanceOf(
      TestsValidationError,
    );
  });
});
