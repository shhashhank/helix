/**
 * Plan grounding (HELIX-99): pull relevant files / conventions from the existing
 * codebase so planning reflects what's already there instead of happening in a
 * vacuum.
 *
 * Retrieval is an injected {@link CodebaseRetriever} seam — the host wires it to
 * a real code index (e.g. `@helix/agent`'s hybrid `Retriever` over an embedded
 * repo) in ~5 lines, while this module stays dependency-free and fully testable.
 * Given a spec we derive a handful of search queries, retrieve per query, then
 * merge/dedupe/rank the snippets into a compact grounding context that the
 * planning steps (extraction, decomposition, tech-stack) can put in their prompt.
 */
import { RequirementsSpec } from './requirements';

/** A retrieved piece of the codebase. */
export interface RetrievedSnippet {
  /** Source identifier — typically a file path (used to dedupe). */
  ref: string;
  content: string;
  /** Relevance score, higher is better (optional). */
  score?: number;
  metadata?: Record<string, unknown>;
}

/** The retrieval seam: query the codebase index, return the most relevant snippets. */
export interface CodebaseRetriever {
  retrieve(query: string, limit?: number): Promise<RetrievedSnippet[]>;
}

export interface GroundingOptions {
  /** Max snippets in the final grounding (default 8). */
  limit?: number;
  /** Snippets to pull per query before merging (default 4). */
  perQuery?: number;
  /** Cap on the number of queries run (default 8). */
  maxQueries?: number;
  /** Extra queries to run beyond the spec-derived ones. */
  extraQueries?: string[];
}

export interface PlanGrounding {
  /** The queries actually run. */
  queries: string[];
  /** Deduped, relevance-ranked snippets. */
  snippets: RetrievedSnippet[];
}

/**
 * Derive search queries from a spec: a title+summary query, each functional
 * requirement, the goals, then any extras — deduped, trimmed, and capped.
 */
export function buildGroundingQueries(spec: RequirementsSpec, extraQueries: string[] = []): string[] {
  const candidates = [
    `${spec.title}: ${spec.summary}`,
    ...spec.functionalRequirements.map((r) => r.description),
    ...spec.goals,
    ...extraQueries,
  ];
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const raw of candidates) {
    const q = raw.trim();
    if (q && !seen.has(q)) {
      seen.add(q);
      queries.push(q);
    }
  }
  return queries;
}

/**
 * Ground a spec against the codebase: run the derived queries through the
 * retriever, merge results, dedupe by `ref` (keeping the highest score), rank by
 * score, and cap at `limit`.
 */
export async function groundRequirements(
  spec: RequirementsSpec,
  retriever: CodebaseRetriever,
  options: GroundingOptions = {},
): Promise<PlanGrounding> {
  const maxQueries = options.maxQueries ?? 8;
  const perQuery = options.perQuery ?? 4;
  const limit = options.limit ?? 8;

  const queries = buildGroundingQueries(spec, options.extraQueries).slice(0, maxQueries);

  const byRef = new Map<string, RetrievedSnippet>();
  for (const query of queries) {
    for (const snippet of await retriever.retrieve(query, perQuery)) {
      const existing = byRef.get(snippet.ref);
      if (!existing || (snippet.score ?? 0) > (existing.score ?? 0)) {
        byRef.set(snippet.ref, snippet);
      }
    }
  }

  const snippets = [...byRef.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);

  return { queries, snippets };
}

/**
 * Render a grounding as a prompt-ready block the planning steps can include so
 * their output reflects the existing codebase.
 */
export function formatGrounding(grounding: PlanGrounding): string {
  if (grounding.snippets.length === 0) {
    return '<codebase_context>\n(no relevant existing code found)\n</codebase_context>';
  }
  const blocks = grounding.snippets.map((s) => {
    const score = typeof s.score === 'number' ? ` (score ${s.score.toFixed(2)})` : '';
    return `// ${s.ref}${score}\n${s.content}`;
  });
  return ['<codebase_context>', blocks.join('\n---\n'), '</codebase_context>'].join('\n');
}
