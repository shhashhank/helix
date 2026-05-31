import {
  DEFAULT_ROUTE_POLICY,
  ModelRouter,
  RoutePolicy,
  applyRouteToRequest,
} from '../lib/routing';
import { LlmCompletionRequest } from '../lib/types';

describe('ModelRouter.route', () => {
  const router = new ModelRouter();

  it('maps well-known task classes to the expected tier + effort', () => {
    expect(router.route('coding')).toMatchObject({ tier: 'opus', effort: 'xhigh' });
    expect(router.route('planning')).toMatchObject({ tier: 'opus', effort: 'high' });
    expect(router.route('testing')).toMatchObject({ tier: 'sonnet', effort: 'medium' });
  });

  it('falls back to the default entry for an unknown task class', () => {
    const decision = router.route('something-new');
    expect(decision).toMatchObject({
      taskClass: 'something-new',
      tier: DEFAULT_ROUTE_POLICY.default.tier,
    });
  });

  it('never emits effort on the Haiku tier', () => {
    expect(router.route('classification').effort).toBeUndefined();
    expect(router.route('summarization').effort).toBeUndefined();
  });

  it('drops effort when an override switches to Haiku', () => {
    const decision = router.route('coding', { tier: 'haiku' });
    expect(decision.tier).toBe('haiku');
    expect(decision.effort).toBeUndefined();
  });

  it('lets overrides win over the policy (tier + ceiling)', () => {
    const decision = router.route('classification', { tier: 'opus', costCeilingUsd: 0.01 });
    expect(decision).toMatchObject({ tier: 'opus', costCeilingUsd: 0.01 });
  });

  it('carries the cost ceiling from the policy', () => {
    expect(router.route('coding').costCeilingUsd).toBe(2.0);
  });

  it('honors a custom policy', () => {
    const policy: RoutePolicy = {
      default: { tier: 'haiku' },
      special: { tier: 'opus', effort: 'max' },
    };
    const custom = new ModelRouter(policy);
    expect(custom.route('special')).toMatchObject({ tier: 'opus', effort: 'max' });
    expect(custom.route('anything-else').tier).toBe('haiku');
  });
});

describe('applyRouteToRequest', () => {
  const base: LlmCompletionRequest = { messages: [{ role: 'user', content: 'hi' }] };

  it('fills tier/effort/maxTokens from the decision', () => {
    const router = new ModelRouter();
    const out = applyRouteToRequest(router.route('coding'), base);
    expect(out).toMatchObject({ tier: 'opus', effort: 'xhigh' });
    expect(out.messages).toBe(base.messages);
  });

  it("preserves the caller's explicit fields over the decision", () => {
    const router = new ModelRouter();
    const out = applyRouteToRequest(router.route('coding'), {
      ...base,
      tier: 'haiku',
      effort: 'low',
    });
    expect(out).toMatchObject({ tier: 'haiku', effort: 'low' });
  });
});
