/**
 * Review posting (HELIX-115): turn the merged {@link Finding}s into the comments
 * a reviewer leaves on a PR — **inline** comments (file + line) for located
 * findings, and a **summary** comment with the verdict and counts.
 *
 * Formatting is deterministic and offline-testable. *Posting* goes through an
 * injected {@link ReviewPoster} seam; the live implementation posts via the
 * GitHub tools (`@helix/github-mcp`), which needs the deferred Octokit binding.
 * The chosen review event (approve / comment / request changes) follows the
 * severity model — the merge gate (HELIX-116) builds on the same signal.
 */
import {
  Finding,
  isBlocking,
  REVIEW_SEVERITIES,
  ReviewSeverity,
  summarizeFindings,
} from './findings';

export interface InlineComment {
  path: string;
  line: number;
  body: string;
}

export type ReviewEvent = 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';

export interface ReviewPosting {
  inline: InlineComment[];
  summary: string;
  event: ReviewEvent;
}

/** Posts a built review to the PR (real impl: GitHub tools). */
export interface ReviewPoster {
  post(posting: ReviewPosting): Promise<void>;
}

/** Build inline comments for findings that have a line (others go to the summary). */
export function buildInlineComments(findings: Finding[]): InlineComment[] {
  return findings
    .filter((f): f is Finding & { line: number } => typeof f.line === 'number')
    .map((f) => ({ path: f.file, line: f.line, body: findingBody(f) }));
}

function findingBody(f: Finding): string {
  const parts = [`**${f.severity.toUpperCase()} · ${f.aspect}**`, '', f.message];
  if (f.suggestion) parts.push('', `💡 ${f.suggestion}`);
  return parts.join('\n');
}

export interface BuildReviewOptions {
  /** Severity at/above which the review requests changes (default `major`). */
  blockThreshold?: ReviewSeverity;
  /** Max findings listed in the summary (default 50). */
  maxSummaryFindings?: number;
}

/** Build the markdown summary comment: verdict, counts, and a findings list. */
export function buildReviewSummary(findings: Finding[], options: BuildReviewOptions = {}): string {
  const summary = summarizeFindings(findings);
  const blocking = isBlocking(findings, options.blockThreshold);
  const max = options.maxSummaryFindings ?? 50;

  const header =
    summary.total === 0
      ? '### ✅ Code review: no issues found'
      : blocking
        ? '### ❌ Code review: changes requested'
        : `### ⚠️ Code review: ${summary.total} non-blocking finding(s)`;

  const counts = REVIEW_SEVERITIES.filter((s) => summary.bySeverity[s] > 0)
    .map((s) => `${summary.bySeverity[s]} ${s}`)
    .join(' · ');

  const lines = [header, ''];
  if (counts) lines.push(`**Findings:** ${summary.total} — ${counts}`, '');

  const shown = [...findings]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, max);
  for (const f of shown) {
    const loc = f.line !== undefined ? `${f.file}:${f.line}` : f.file;
    lines.push(`- **${f.severity}** [${f.aspect}] ${loc} — ${f.message}`);
  }
  if (findings.length > max) lines.push(`- … and ${findings.length - max} more`);

  return lines.join('\n');
}

const SEVERITY_RANK: Record<ReviewSeverity, number> = { info: 0, minor: 1, major: 2, blocker: 3 };
function severityRank(s: ReviewSeverity): number {
  return SEVERITY_RANK[s];
}

/** Assemble the full review posting (inline + summary + event) from findings. */
export function buildReviewPosting(findings: Finding[], options: BuildReviewOptions = {}): ReviewPosting {
  const event: ReviewEvent =
    findings.length === 0 ? 'APPROVE' : isBlocking(findings, options.blockThreshold) ? 'REQUEST_CHANGES' : 'COMMENT';
  return {
    inline: buildInlineComments(findings),
    summary: buildReviewSummary(findings, options),
    event,
  };
}

/** Build the review posting and send it via the poster; returns what was posted. */
export async function postReview(
  poster: ReviewPoster,
  findings: Finding[],
  options: BuildReviewOptions = {},
): Promise<ReviewPosting> {
  const posting = buildReviewPosting(findings, options);
  await poster.post(posting);
  return posting;
}
