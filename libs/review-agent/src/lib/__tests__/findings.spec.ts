import type { LlmCompletion, LlmCompletionRequest, LlmContentPart, LlmProvider } from '@helix/llm';
import { ReviewContext } from '../review-context';
import {
  Finding,
  FINDINGS_TOOL_NAME,
  FindingsValidationError,
  isBlocking,
  parseFindings,
  reviewAllFindings,
  reviewForFindings,
  ReviewFindingsError,
  summarizeFindings,
} from '../findings';

const context: ReviewContext = {
  files: [{ path: 'src/a.ts', status: 'added', diff: '+ x', additions: 1, deletions: 0 }],
  summary: { fileCount: 1, additions: 1, deletions: 0 },
};

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
        usage: { inputTokens: 2, outputTokens: 3, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
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
  name: FINDINGS_TOOL_NAME,
  input,
});

describe('parseFindings', () => {
  it('validates and stamps the aspect on each finding', () => {
    const findings = parseFindings(
      { findings: [{ severity: 'major', file: 'src/a.ts', line: 3, message: 'bug' }] },
      'correctness',
    );
    expect(findings).toEqual([
      { aspect: 'correctness', severity: 'major', file: 'src/a.ts', line: 3, message: 'bug' },
    ]);
  });

  it('accepts an empty findings list', () => {
    expect(parseFindings({ findings: [] }, 'security')).toEqual([]);
  });

  it('rejects an invalid severity or missing field', () => {
    expect(() => parseFindings({ findings: [{ severity: 'nope', file: 'a', message: 'm' }] }, 'style')).toThrow(
      FindingsValidationError,
    );
    expect(() => parseFindings({ findings: [{ severity: 'minor', message: 'm' }] }, 'style')).toThrow(
      FindingsValidationError,
    );
  });
});

describe('reviewForFindings', () => {
  it('forces the tool and returns aspect-stamped findings', async () => {
    let seen: LlmCompletionRequest | undefined;
    const llm = fakeLlm(
      [tool({ findings: [{ severity: 'blocker', file: 'src/a.ts', message: 'sql injection' }] })],
      (r) => (seen = r),
    );
    const result = await reviewForFindings(context, 'security', llm);
    expect(result.findings[0]).toMatchObject({ aspect: 'security', severity: 'blocker' });
    expect(seen?.toolChoice).toEqual({ name: FINDINGS_TOOL_NAME });
    expect(seen?.system).toMatch(/security review/i);
  });

  it('throws when the model returns no tool call', async () => {
    await expect(reviewForFindings(context, 'style', fakeLlm([{ type: 'text', text: 'lgtm' }]))).rejects.toBeInstanceOf(
      ReviewFindingsError,
    );
  });
});

describe('reviewAllFindings', () => {
  it('runs the requested aspects and merges findings + usage', async () => {
    const llm = fakeLlm([tool({ findings: [{ severity: 'minor', file: 'src/a.ts', message: 'nit' }] })]);
    const { findings, usage } = await reviewAllFindings(context, llm, {
      aspects: ['correctness', 'security'],
    });
    expect(findings.map((f) => f.aspect)).toEqual(['correctness', 'security']);
    expect(usage.outputTokens).toBe(6); // 2 calls × 3
  });
});

describe('severity model', () => {
  const findings: Finding[] = [
    { aspect: 'security', severity: 'blocker', file: 'a', message: 'm' },
    { aspect: 'correctness', severity: 'minor', file: 'b', message: 'm' },
    { aspect: 'correctness', severity: 'info', file: 'c', message: 'm' },
  ];

  it('summarises counts by severity + aspect and the highest severity', () => {
    const s = summarizeFindings(findings);
    expect(s.total).toBe(3);
    expect(s.bySeverity).toMatchObject({ blocker: 1, minor: 1, info: 1, major: 0 });
    expect(s.byAspect).toEqual({ security: 1, correctness: 2 });
    expect(s.highestSeverity).toBe('blocker');
  });

  it('isBlocking respects the threshold', () => {
    expect(isBlocking(findings)).toBe(true); // blocker >= major
    expect(isBlocking([findings[1], findings[2]])).toBe(false); // minor/info only
    expect(isBlocking([findings[1]], 'minor')).toBe(true); // threshold lowered
  });
});
