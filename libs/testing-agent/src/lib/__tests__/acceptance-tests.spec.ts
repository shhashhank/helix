import type { LlmCompletion, LlmCompletionRequest, LlmContentPart, LlmProvider } from '@helix/llm';
import {
  acceptanceCoverage,
  AcceptanceCriterionTests,
  ACCEPTANCE_TESTS_TOOL_NAME,
  AcceptanceTestsError,
  AcceptanceTestsValidationError,
  generateAcceptanceTests,
  parseAcceptanceMapping,
} from '../acceptance-tests';

const criteria = [
  'Creating a note then fetching it returns the note',
  'Listing notes returns all created notes',
];

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
        usage: { inputTokens: 3, outputTokens: 7, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
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
  name: ACCEPTANCE_TESTS_TOOL_NAME,
  input,
});

describe('parseAcceptanceMapping', () => {
  it('resolves criterionIndex to its text', () => {
    const mappings = parseAcceptanceMapping(
      { mappings: [{ criterionIndex: 1, tests: [{ path: 'a.spec.ts', content: 'it(...)' }] }] },
      criteria,
    );
    expect(mappings[0]).toMatchObject({ criterionIndex: 1, criterion: criteria[1] });
    expect(mappings[0].tests).toHaveLength(1);
  });

  it('rejects an out-of-range criterionIndex', () => {
    expect(() =>
      parseAcceptanceMapping({ mappings: [{ criterionIndex: 9, tests: [{ path: 'a', content: 'b' }] }] }, criteria),
    ).toThrow(/out of range/);
  });

  it('rejects a mapping with no tests', () => {
    expect(() => parseAcceptanceMapping({ mappings: [{ criterionIndex: 0, tests: [] }] }, criteria)).toThrow(
      AcceptanceTestsValidationError,
    );
  });
});

describe('generateAcceptanceTests', () => {
  it('forces the tool, numbers the criteria, and returns traceable mappings', async () => {
    let seen: LlmCompletionRequest | undefined;
    const llm = fakeLlm(
      [
        tool({
          mappings: [
            { criterionIndex: 0, tests: [{ path: 'note.spec.ts', content: 'create+get' }] },
            { criterionIndex: 1, tests: [{ path: 'list.spec.ts', content: 'list' }] },
          ],
        }),
      ],
      (r) => (seen = r),
    );

    const result = await generateAcceptanceTests({ criteria, framework: 'jest' }, llm);

    expect(result.mappings.map((m) => m.criterionIndex)).toEqual([0, 1]);
    expect(result.mappings[0].criterion).toBe(criteria[0]);
    expect(seen?.toolChoice).toEqual({ name: ACCEPTANCE_TESTS_TOOL_NAME });
    expect(JSON.stringify(seen?.messages)).toContain('0. Creating a note'); // numbered criteria
  });

  it('throws on empty criteria without calling the model', async () => {
    let called = false;
    const llm = fakeLlm([tool({ mappings: [] })], () => (called = true));
    await expect(generateAcceptanceTests({ criteria: [], framework: 'jest' }, llm)).rejects.toBeInstanceOf(
      AcceptanceTestsError,
    );
    expect(called).toBe(false);
  });

  it('throws when the model returns no tool call', async () => {
    await expect(
      generateAcceptanceTests({ criteria, framework: 'jest' }, fakeLlm([{ type: 'text', text: '...' }])),
    ).rejects.toBeInstanceOf(AcceptanceTestsError);
  });
});

describe('acceptanceCoverage', () => {
  it('reports covered and uncovered criteria', () => {
    const mappings: AcceptanceCriterionTests[] = [
      { criterionIndex: 0, criterion: criteria[0], tests: [{ path: 'a', content: 'b' }] },
    ];
    const cov = acceptanceCoverage(criteria, mappings);
    expect(cov.total).toBe(2);
    expect(cov.coveredIndices).toEqual([0]);
    expect(cov.uncovered).toEqual([{ index: 1, criterion: criteria[1] }]);
    expect(cov.fullyCovered).toBe(false);
  });

  it('is fully covered when every criterion has a test', () => {
    const mappings: AcceptanceCriterionTests[] = criteria.map((criterion, index) => ({
      criterionIndex: index,
      criterion,
      tests: [{ path: `${index}.spec.ts`, content: 'x' }],
    }));
    expect(acceptanceCoverage(criteria, mappings).fullyCovered).toBe(true);
  });
});
