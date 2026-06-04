import { ToolRequest } from '../policy';
import {
  FixedWindowRateLimiter,
  QuotaPolicy,
  RateLimitExceededError,
  ToolQuotaEnforcer,
} from '../rate-limit';

/** A controllable clock for deterministic window tests. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const req = (over: Partial<ToolRequest> = {}): ToolRequest => ({
  orgId: 'org1',
  agentRole: 'coding',
  serverId: 'gh',
  toolName: 'create_pr',
  ...over,
});

describe('FixedWindowRateLimiter', () => {
  it('allows up to the limit, then blocks, then resets after the window', () => {
    const c = clock();
    const rl = new FixedWindowRateLimiter(c.now);
    const limit = { limit: 2, windowMs: 1000 };

    expect(rl.check('k', limit)).toMatchObject({ allowed: true, remaining: 1 });
    expect(rl.check('k', limit)).toMatchObject({ allowed: true, remaining: 0 });
    expect(rl.check('k', limit)).toMatchObject({ allowed: false, remaining: 0 }); // over

    c.advance(1000); // new window
    expect(rl.check('k', limit)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('tracks keys independently', () => {
    const rl = new FixedWindowRateLimiter(clock().now);
    const limit = { limit: 1, windowMs: 1000 };
    expect(rl.check('a', limit).allowed).toBe(true);
    expect(rl.check('a', limit).allowed).toBe(false);
    expect(rl.check('b', limit).allowed).toBe(true); // different key, fresh
  });
});

describe('ToolQuotaEnforcer', () => {
  const policy = (rules: QuotaPolicy['rules']): QuotaPolicy => ({ rules });

  it('allows everything when no rule matches (unlimited)', () => {
    const enforcer = new ToolQuotaEnforcer(policy([{ orgId: 'other', limit: 1, windowMs: 1000 }]));
    const d = enforcer.check(req());
    expect(d.allowed).toBe(true);
    expect(d.rule).toBeUndefined();
  });

  it('caps an org\'s total tool calls (org-scoped rule shares one bucket)', () => {
    const c = clock();
    const enforcer = new ToolQuotaEnforcer(
      policy([{ id: 'org-cap', orgId: 'org1', limit: 2, windowMs: 1000 }]),
      new FixedWindowRateLimiter(c.now),
    );
    expect(enforcer.check(req({ toolName: 'create_pr' })).allowed).toBe(true);
    expect(enforcer.check(req({ toolName: 'list_issues' })).allowed).toBe(true); // same org bucket
    expect(enforcer.check(req({ toolName: 'read_file' })).allowed).toBe(false); // org1 over its 2/window
    expect(enforcer.check(req({ orgId: 'org2' })).allowed).toBe(true); // different org, own bucket
  });

  it('caps per tool when the rule is tool-scoped', () => {
    const enforcer = new ToolQuotaEnforcer(
      policy([{ id: 'pr-cap', toolName: 'create_pr', limit: 1, windowMs: 1000 }]),
      new FixedWindowRateLimiter(clock().now),
    );
    expect(enforcer.check(req({ toolName: 'create_pr' })).allowed).toBe(true);
    expect(enforcer.check(req({ toolName: 'create_pr' })).allowed).toBe(false); // tool over
    expect(enforcer.check(req({ toolName: 'list_issues' })).allowed).toBe(true); // other tool unaffected
  });

  it('enforce throws RateLimitExceededError when over quota', () => {
    const enforcer = new ToolQuotaEnforcer(
      policy([{ toolName: 'create_pr', limit: 1, windowMs: 1000 }]),
      new FixedWindowRateLimiter(clock().now),
    );
    expect(enforcer.enforce(req()).allowed).toBe(true);
    expect(() => enforcer.enforce(req())).toThrow(RateLimitExceededError);
  });
});
