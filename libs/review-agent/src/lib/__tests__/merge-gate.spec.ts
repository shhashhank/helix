import { Finding } from '../findings';
import {
  DEFAULT_REVIEW_POLICY,
  evaluateMergeGate,
  MERGE_GATE_CONTEXT,
  publishMergeGate,
  StatusCheck,
  StatusCheckPublisher,
  toStatusCheck,
} from '../merge-gate';

const f = (severity: Finding['severity']): Finding => ({
  aspect: 'correctness',
  severity,
  file: 'src/a.ts',
  message: `a ${severity} issue`,
});

describe('evaluateMergeGate', () => {
  it('passes with no findings', () => {
    const d = evaluateMergeGate([]);
    expect(d.state).toBe('pass');
    expect(d.blocked).toBe(false);
    expect(d.reason).toMatch(/no findings/i);
  });

  it('fails at/above the default threshold (major)', () => {
    const d = evaluateMergeGate([f('major'), f('minor')]);
    expect(d.state).toBe('fail');
    expect(d.blocked).toBe(true);
    expect(d.blockingFindings).toHaveLength(1); // only the major
    expect(d.reason).toContain('"major"');
  });

  it('passes when findings are below the threshold', () => {
    const d = evaluateMergeGate([f('minor'), f('info')]);
    expect(d.state).toBe('pass');
    expect(d.reason).toMatch(/non-blocking/);
  });

  it('honours a stricter policy (block only on blocker)', () => {
    const policy = { blockThreshold: 'blocker' as const };
    expect(evaluateMergeGate([f('major')], policy).state).toBe('pass'); // major no longer blocks
    expect(evaluateMergeGate([f('blocker')], policy).state).toBe('fail');
  });

  it('uses the default policy when none is given', () => {
    expect(evaluateMergeGate([f('major')]).policy).toEqual(DEFAULT_REVIEW_POLICY);
  });
});

describe('toStatusCheck', () => {
  it('maps the decision to a status check and truncates the description', () => {
    const decision = evaluateMergeGate([f('blocker')]);
    const check = toStatusCheck(decision);
    expect(check.state).toBe('fail');
    expect(check.context).toBe(MERGE_GATE_CONTEXT);
    expect(check.description.length).toBeLessThanOrEqual(140);
  });
});

describe('publishMergeGate', () => {
  it('publishes the status check via the publisher', async () => {
    let published: StatusCheck | undefined;
    const publisher: StatusCheckPublisher = {
      async publish(c) {
        published = c;
      },
    };
    const check = await publishMergeGate(publisher, evaluateMergeGate([f('major')]), { context: 'ci/helix' });
    expect(published).toBe(check);
    expect(published?.state).toBe('fail');
    expect(published?.context).toBe('ci/helix');
  });
});
