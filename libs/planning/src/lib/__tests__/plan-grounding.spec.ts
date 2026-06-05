import {
  buildGroundingQueries,
  CodebaseRetriever,
  formatGrounding,
  groundRequirements,
  RetrievedSnippet,
} from '../plan-grounding';
import { RequirementsSpec } from '../requirements';

const spec: RequirementsSpec = {
  title: 'Notes API',
  summary: 'Create and list notes.',
  goals: ['Persist notes'],
  functionalRequirements: [
    { id: 'FR-1', description: 'Create a note', priority: 'must' },
    { id: 'FR-2', description: 'List notes', priority: 'must' },
  ],
  nonFunctionalRequirements: [],
  constraints: [],
  assumptions: [],
  outOfScope: [],
  openQuestions: [],
  acceptanceCriteria: ['POST then GET returns the note'],
};

/** A retriever that returns canned snippets per query and records the queries seen. */
function fakeRetriever(
  byQuery: Record<string, RetrievedSnippet[]>,
  seen?: string[],
): CodebaseRetriever {
  return {
    async retrieve(query: string): Promise<RetrievedSnippet[]> {
      seen?.push(query);
      return byQuery[query] ?? [];
    },
  };
}

describe('buildGroundingQueries', () => {
  it('derives queries from title/summary, requirements, and goals, deduped', () => {
    const queries = buildGroundingQueries(spec);
    expect(queries[0]).toBe('Notes API: Create and list notes.');
    expect(queries).toEqual(expect.arrayContaining(['Create a note', 'List notes', 'Persist notes']));
    // deduped
    expect(new Set(queries).size).toBe(queries.length);
  });

  it('appends extra queries', () => {
    expect(buildGroundingQueries(spec, ['existing notes module'])).toContain('existing notes module');
  });
});

describe('groundRequirements', () => {
  it('runs queries, dedupes by ref keeping the highest score, and ranks/caps', async () => {
    const seen: string[] = [];
    const retriever = fakeRetriever(
      {
        'Notes API: Create and list notes.': [
          { ref: 'src/notes.ts', content: 'class Notes {}', score: 0.5 },
          { ref: 'src/db.ts', content: 'pg pool', score: 0.9 },
        ],
        'Create a note': [
          { ref: 'src/notes.ts', content: 'class Notes {}', score: 0.8 }, // higher score wins
        ],
        'List notes': [{ ref: 'src/list.ts', content: 'list()', score: 0.3 }],
        'Persist notes': [],
      },
      seen,
    );

    const grounding = await groundRequirements(spec, retriever, { limit: 2 });

    // all derived queries were run
    expect(seen).toEqual(expect.arrayContaining(['Create a note', 'List notes', 'Persist notes']));
    // deduped by ref; src/notes.ts kept the 0.8 score; ranked desc; capped at 2
    expect(grounding.snippets.map((s) => s.ref)).toEqual(['src/db.ts', 'src/notes.ts']);
    expect(grounding.snippets.find((s) => s.ref === 'src/notes.ts')?.score).toBe(0.8);
  });

  it('respects perQuery and maxQueries limits', async () => {
    const seen: string[] = [];
    const retriever = fakeRetriever({}, seen);
    await groundRequirements(spec, retriever, { maxQueries: 1 });
    expect(seen).toEqual(['Notes API: Create and list notes.']); // only the first query ran
  });

  it('returns an empty snippet list when nothing matches', async () => {
    const grounding = await groundRequirements(spec, fakeRetriever({}));
    expect(grounding.snippets).toEqual([]);
    expect(grounding.queries.length).toBeGreaterThan(0);
  });
});

describe('formatGrounding', () => {
  it('renders snippets into a prompt-ready block with refs and scores', () => {
    const block = formatGrounding({
      queries: ['q'],
      snippets: [{ ref: 'src/a.ts', content: 'code', score: 0.42 }],
    });
    expect(block).toContain('<codebase_context>');
    expect(block).toContain('// src/a.ts (score 0.42)');
    expect(block).toContain('code');
  });

  it('renders a placeholder when there is no context', () => {
    expect(formatGrounding({ queries: [], snippets: [] })).toContain('no relevant existing code');
  });
});
