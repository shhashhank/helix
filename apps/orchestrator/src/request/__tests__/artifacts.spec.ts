import type { WorkflowProgress } from '@helix/workflow';
import { extractArtifacts } from '../artifacts';

const steps = (outputs: Record<string, unknown>): Pick<WorkflowProgress, 'steps'> => ({
  steps: Object.fromEntries(
    Object.entries(outputs).map(([id, output]) => [id, { id, ran: true, status: 'success' as const, output }]),
  ),
});

describe('extractArtifacts', () => {
  it('pulls PR, tests, and deploy from across the run steps', () => {
    const artifacts = extractArtifacts(
      steps({
        code: { prUrl: 'https://github.com/o/r/pull/7', prTitle: 'Add todo API' },
        test: { tests: { passed: 12, failed: 0, coverage: 88 } },
        deploy: { liveUrl: 'https://app.example.com', environment: 'staging' },
      }),
    );
    expect(artifacts).toEqual({
      pullRequest: { url: 'https://github.com/o/r/pull/7', title: 'Add todo API' },
      tests: { passed: 12, failed: 0, coverage: 88 },
      deployment: { url: 'https://app.example.com', environment: 'staging' },
    });
  });

  it('accepts alternate field names and omits optional sub-fields when absent', () => {
    const artifacts = extractArtifacts(
      steps({
        code: { pullRequestUrl: 'https://x/pull/1' }, // no title
        test: { tests: { passed: 3, failed: 1 } }, // no coverage
        deploy: { deploymentUrl: 'https://y' }, // no environment
      }),
    );
    expect(artifacts).toEqual({
      pullRequest: { url: 'https://x/pull/1' },
      tests: { passed: 3, failed: 1 },
      deployment: { url: 'https://y' },
    });
  });

  it('returns whatever has been produced so far (partial run)', () => {
    expect(extractArtifacts(steps({ plan: { note: 'planning…' }, code: { prUrl: 'https://x/pull/9' } }))).toEqual({
      pullRequest: { url: 'https://x/pull/9' },
    });
  });

  it('returns empty when no step has artifacts, ignoring non-object / skipped outputs', () => {
    expect(extractArtifacts(steps({ plan: 'just a string', code: null, review: { unrelated: true } }))).toEqual({});
  });

  it('first match wins when multiple steps carry the same artifact type', () => {
    const artifacts = extractArtifacts(steps({ a: { prUrl: 'https://x/pull/1' }, b: { prUrl: 'https://x/pull/2' } }));
    expect(artifacts.pullRequest?.url).toBe('https://x/pull/1');
  });

  it('ignores a malformed tests object (missing passed/failed)', () => {
    expect(extractArtifacts(steps({ test: { tests: { coverage: 90 } } })).tests).toBeUndefined();
  });

  it('reads the delivery role’s structured pullRequest + change-set (HELIX-185)', () => {
    const artifacts = extractArtifacts(
      steps({
        deliver: {
          pullRequest: { number: 9, url: 'https://github.com/o/r/pull/9' },
          changeSet: { filesChanged: 4, additions: 120, deletions: 7 },
        },
      }),
    );
    expect(artifacts.pullRequest).toEqual({ url: 'https://github.com/o/r/pull/9' });
    expect(artifacts.changeSet).toEqual({ filesChanged: 4, additions: 120, deletions: 7 });
  });

  it('surfaces the change-set even on a skipped delivery (no PR)', () => {
    const artifacts = extractArtifacts(steps({ deliver: { delivered: false, changeSet: { filesChanged: 2, additions: 10, deletions: 0 } } }));
    expect(artifacts.pullRequest).toBeUndefined();
    expect(artifacts.changeSet).toEqual({ filesChanged: 2, additions: 10, deletions: 0 });
  });
});
