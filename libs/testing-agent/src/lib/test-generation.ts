/**
 * Test generation (HELIX-117): drive the LLM to write tests for source code,
 * with **per-framework** prompts (Jest, Vitest, PyTest, Mocha) so the generated
 * tests follow each framework's conventions.
 *
 * Structured output via a forced tool — the model returns test files (path +
 * content) validated against the schema. The LLM is injected; prompt
 * construction is deterministic and the generator is offline-testable.
 */
import type {
  Effort,
  LlmCallContext,
  LlmCompletion,
  LlmProvider,
  LlmToolDef,
  LlmToolUsePart,
  LlmUsage,
  ModelTier,
} from '@helix/llm';
import { z } from 'zod';

export const TEST_FRAMEWORKS = ['jest', 'vitest', 'pytest', 'mocha'] as const;
export type TestFramework = (typeof TEST_FRAMEWORKS)[number];

/** Per-framework conventions the generated tests should follow. */
export const FRAMEWORK_CONVENTIONS: Record<TestFramework, string> = {
  jest:
    'Jest: `describe`/`it`, `expect` assertions, `*.spec.ts` next to the source or under `__tests__`; mock with `jest.fn()`.',
  vitest:
    'Vitest: `describe`/`it`, `expect`, `*.test.ts`; import from "vitest" and mock with `vi.fn()`.',
  pytest:
    'PyTest: `test_*.py` files, plain `assert`, fixtures via `@pytest.fixture`, `pytest.raises` for errors.',
  mocha:
    'Mocha: `describe`/`it` with an assertion library (e.g. chai `expect`), `*.spec.ts`.',
};

/** A source file to write tests for. */
export interface SourceFile {
  path: string;
  content: string;
}

/** A generated test file. */
export interface GeneratedTest {
  path: string;
  content: string;
}

const GeneratedTestSchema = z.object({
  path: z.string().min(1).describe('Workspace-relative path for the test file.'),
  content: z.string().min(1).describe('Full test file contents.'),
});
const TestsSetSchema = z.object({ tests: z.array(GeneratedTestSchema) });

export const TESTS_JSON_SCHEMA = z.toJSONSchema(TestsSetSchema) as Record<string, unknown>;

export class TestsValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid generated tests: ${issues.join('; ')}`);
    this.name = 'TestsValidationError';
  }
}

/** Validate tool output into {@link GeneratedTest}s. */
export function parseGeneratedTests(input: unknown): GeneratedTest[] {
  const result = TestsSetSchema.safeParse(input);
  if (!result.success) {
    throw new TestsValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data.tests;
}

export const TESTS_TOOL_NAME = 'emit_tests';

export const TESTS_TOOL: LlmToolDef = {
  name: TESTS_TOOL_NAME,
  description: 'Return the generated test files. Call exactly once.',
  inputSchema: TESTS_JSON_SCHEMA,
};

export function buildTestGenerationSystemPrompt(framework: TestFramework): string {
  return [
    `You are a senior test engineer. Write thorough, focused tests for the given source using ${framework}.`,
    FRAMEWORK_CONVENTIONS[framework],
    'Cover the happy path and the important edge/error cases; keep each test deterministic and isolated;',
    'do not test third-party code. Put each test next to or under the source it covers.',
    `Return the test files by calling ${TESTS_TOOL_NAME} exactly once.`,
  ].join('\n');
}

export interface GenerateTestsInput {
  framework: TestFramework;
  files: SourceFile[];
  /** Extra instructions (e.g. focus areas). */
  instructions?: string;
}

export interface GenerateTestsOptions {
  tier?: ModelTier;
  effort?: Effort;
  context?: LlmCallContext;
}

export interface TestGeneration {
  tests: GeneratedTest[];
  model: string;
  usage: LlmUsage;
}

export class TestGenerationError extends Error {
  constructor(
    message: string,
    public readonly completion?: LlmCompletion,
  ) {
    super(message);
    this.name = 'TestGenerationError';
  }
}

/** Generate tests for the given source files. */
export async function generateTests(
  input: GenerateTestsInput,
  llm: LlmProvider,
  options: GenerateTestsOptions = {},
): Promise<TestGeneration> {
  const completion = await llm.complete({
    tier: options.tier ?? 'opus',
    effort: options.effort,
    system: buildTestGenerationSystemPrompt(input.framework),
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
    tools: [TESTS_TOOL],
    toolChoice: { name: TESTS_TOOL_NAME },
    context: options.context,
  });

  const toolUse = completion.content.find(
    (p): p is LlmToolUsePart => p.type === 'tool_use' && p.name === TESTS_TOOL_NAME,
  );
  if (!toolUse) {
    throw new TestGenerationError(`model did not call ${TESTS_TOOL_NAME}`, completion);
  }
  return { tests: parseGeneratedTests(toolUse.input), model: completion.model, usage: completion.usage };
}

function buildUserPrompt(input: GenerateTestsInput): string {
  const files = input.files
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');
  const parts = [`Write ${input.framework} tests for the following source:`, '', files];
  if (input.instructions?.trim()) {
    parts.push('', `Additional instructions: ${input.instructions.trim()}`);
  }
  return parts.join('\n');
}
