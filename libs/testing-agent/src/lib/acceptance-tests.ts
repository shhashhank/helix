/**
 * Acceptance-criteria → test mapping (HELIX-118): generate tests that verify the
 * Planning Agent's **acceptance criteria**, each test **traceable** back to the
 * criterion it covers — so the suite proves the spec was met, not just that the
 * code runs. A coverage check then flags any criterion left untested.
 *
 * Forced, schema-validated tool output (like the other generators); the model
 * references each criterion by its index, which we resolve + range-check.
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
import { FRAMEWORK_CONVENTIONS, GeneratedTest, SourceFile, TestFramework } from './test-generation';

/** The tests covering one acceptance criterion, traced back to it. */
export interface AcceptanceCriterionTests {
  criterionIndex: number;
  criterion: string;
  tests: GeneratedTest[];
}

const MappingSchema = z.object({
  mappings: z.array(
    z.object({
      criterionIndex: z.number().int().min(0).describe('0-based index of the acceptance criterion.'),
      tests: z
        .array(z.object({ path: z.string().min(1), content: z.string().min(1) }))
        .min(1)
        .describe('Tests that verify this criterion.'),
    }),
  ),
});

export const ACCEPTANCE_TESTS_JSON_SCHEMA = z.toJSONSchema(MappingSchema) as Record<string, unknown>;

export class AcceptanceTestsValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid acceptance-test mapping: ${issues.join('; ')}`);
    this.name = 'AcceptanceTestsValidationError';
  }
}

/** Validate tool output into criterion→tests mappings, resolving + range-checking the index. */
export function parseAcceptanceMapping(
  input: unknown,
  criteria: string[],
): AcceptanceCriterionTests[] {
  const result = MappingSchema.safeParse(input);
  if (!result.success) {
    throw new AcceptanceTestsValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data.mappings.map((m) => {
    if (m.criterionIndex >= criteria.length) {
      throw new AcceptanceTestsValidationError([
        `criterionIndex ${m.criterionIndex} is out of range (have ${criteria.length} criteria)`,
      ]);
    }
    return { criterionIndex: m.criterionIndex, criterion: criteria[m.criterionIndex], tests: m.tests };
  });
}

export const ACCEPTANCE_TESTS_TOOL_NAME = 'emit_acceptance_tests';

export const ACCEPTANCE_TESTS_TOOL: LlmToolDef = {
  name: ACCEPTANCE_TESTS_TOOL_NAME,
  description:
    'Return tests grouped by the acceptance criterion they verify (by criterionIndex). Call exactly once.',
  inputSchema: ACCEPTANCE_TESTS_JSON_SCHEMA,
};

export function buildAcceptanceTestsSystemPrompt(framework: TestFramework): string {
  return [
    `You are a senior test engineer writing ${framework} tests that verify a spec's acceptance criteria.`,
    FRAMEWORK_CONVENTIONS[framework],
    'Each criterion is numbered. Write tests that verify each one — cover the criterion directly,',
    'keep tests deterministic and isolated, and do not invent criteria.',
    `Return the tests via ${ACCEPTANCE_TESTS_TOOL_NAME} exactly once, grouping each test under the`,
    'criterionIndex it covers.',
  ].join('\n');
}

export interface GenerateAcceptanceTestsInput {
  criteria: string[];
  framework: TestFramework;
  /** Source files under test (optional). */
  files?: SourceFile[];
}

export interface GenerateAcceptanceTestsOptions {
  tier?: ModelTier;
  effort?: Effort;
  context?: LlmCallContext;
}

export interface AcceptanceTestGeneration {
  mappings: AcceptanceCriterionTests[];
  model: string;
  usage: LlmUsage;
}

export class AcceptanceTestsError extends Error {
  constructor(
    message: string,
    public readonly completion?: LlmCompletion,
  ) {
    super(message);
    this.name = 'AcceptanceTestsError';
  }
}

/** Generate tests mapped to each acceptance criterion. */
export async function generateAcceptanceTests(
  input: GenerateAcceptanceTestsInput,
  llm: LlmProvider,
  options: GenerateAcceptanceTestsOptions = {},
): Promise<AcceptanceTestGeneration> {
  if (input.criteria.length === 0) {
    throw new AcceptanceTestsError('no acceptance criteria to map');
  }
  const completion = await llm.complete({
    tier: options.tier ?? 'opus',
    effort: options.effort,
    system: buildAcceptanceTestsSystemPrompt(input.framework),
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
    tools: [ACCEPTANCE_TESTS_TOOL],
    toolChoice: { name: ACCEPTANCE_TESTS_TOOL_NAME },
    context: options.context,
  });

  const toolUse = completion.content.find(
    (p): p is LlmToolUsePart =>
      p.type === 'tool_use' && p.name === ACCEPTANCE_TESTS_TOOL_NAME,
  );
  if (!toolUse) {
    throw new AcceptanceTestsError(`model did not call ${ACCEPTANCE_TESTS_TOOL_NAME}`, completion);
  }
  return {
    mappings: parseAcceptanceMapping(toolUse.input, input.criteria),
    model: completion.model,
    usage: completion.usage,
  };
}

export interface AcceptanceCoverage {
  total: number;
  /** Criterion indices that have at least one test. */
  coveredIndices: number[];
  /** Criteria with no test. */
  uncovered: { index: number; criterion: string }[];
  fullyCovered: boolean;
}

/** Which acceptance criteria are covered by the mapped tests, and which are not. */
export function acceptanceCoverage(
  criteria: string[],
  mappings: AcceptanceCriterionTests[],
): AcceptanceCoverage {
  const covered = new Set(mappings.filter((m) => m.tests.length > 0).map((m) => m.criterionIndex));
  const uncovered = criteria
    .map((criterion, index) => ({ index, criterion }))
    .filter(({ index }) => !covered.has(index));
  return {
    total: criteria.length,
    coveredIndices: [...covered].sort((a, b) => a - b),
    uncovered,
    fullyCovered: uncovered.length === 0,
  };
}

function buildUserPrompt(input: GenerateAcceptanceTestsInput): string {
  const criteria = input.criteria.map((c, i) => `${i}. ${c}`).join('\n');
  const parts = [`Write ${input.framework} tests for these acceptance criteria:`, '', criteria];
  if (input.files?.length) {
    const files = input.files.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
    parts.push('', 'Source under test:', '', files);
  }
  return parts.join('\n');
}
