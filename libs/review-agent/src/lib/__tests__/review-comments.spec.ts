import { Finding } from '../findings';
import {
  buildInlineComments,
  buildReviewPosting,
  buildReviewSummary,
  postReview,
  ReviewPoster,
  ReviewPosting,
} from '../review-comments';

const findings: Finding[] = [
  { aspect: 'security', severity: 'blocker', file: 'src/a.ts', line: 12, message: 'SQL injection', suggestion: 'Parameterise the query.' },
  { aspect: 'correctness', severity: 'minor', file: 'src/b.ts', line: 4, message: 'off-by-one' },
  { aspect: 'style', severity: 'info', file: 'src/c.ts', message: 'rename for clarity' }, // no line
];

describe('buildInlineComments', () => {
  it('makes inline comments only for findings with a line', () => {
    const inline = buildInlineComments(findings);
    expect(inline.map((c) => `${c.path}:${c.line}`)).toEqual(['src/a.ts:12', 'src/b.ts:4']);
    expect(inline[0].body).toContain('BLOCKER · security');
    expect(inline[0].body).toContain('SQL injection');
    expect(inline[0].body).toContain('💡 Parameterise the query.');
  });
});

describe('buildReviewSummary', () => {
  it('renders the changes-requested verdict, counts, and a findings list', () => {
    const summary = buildReviewSummary(findings);
    expect(summary).toContain('### ❌ Code review: changes requested');
    expect(summary).toContain('**Findings:** 3 — 1 blocker · 1 minor · 1 info');
    expect(summary).toContain('- **blocker** [security] src/a.ts:12 — SQL injection');
    expect(summary).toContain('- **info** [style] src/c.ts — rename for clarity'); // no line
  });

  it('renders an approve verdict when there are no findings', () => {
    expect(buildReviewSummary([])).toContain('### ✅ Code review: no issues found');
  });

  it('renders a non-blocking verdict when nothing reaches the threshold', () => {
    const minorOnly = [findings[1], findings[2]];
    expect(buildReviewSummary(minorOnly)).toContain('non-blocking finding(s)');
  });
});

describe('buildReviewPosting', () => {
  it('chooses the event from the severity model', () => {
    expect(buildReviewPosting([]).event).toBe('APPROVE');
    expect(buildReviewPosting(findings).event).toBe('REQUEST_CHANGES'); // has a blocker
    expect(buildReviewPosting([findings[1]]).event).toBe('COMMENT'); // minor only
  });
});

describe('postReview', () => {
  it('builds and sends the posting via the poster', async () => {
    let posted: ReviewPosting | undefined;
    const poster: ReviewPoster = {
      async post(p) {
        posted = p;
      },
    };
    const result = await postReview(poster, findings);
    expect(posted).toBe(result);
    expect(posted?.event).toBe('REQUEST_CHANGES');
    expect(posted?.inline).toHaveLength(2);
    expect(posted?.summary).toContain('changes requested');
  });
});
