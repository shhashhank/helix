import {
  ApprovalPolicy,
  GateContext,
  defaultApprovalPolicy,
  evaluatePolicy,
  matchesCondition,
  parseApprovalPolicy,
  safeParseApprovalPolicy,
} from '../policy';

describe('matchesCondition', () => {
  const ctx: GateContext = {
    action: 'deploy',
    environment: 'prod',
    agentRole: 'deployment-agent',
    riskLevel: 'high',
    estimatedCostUsd: 40,
    tags: ['db-migration'],
  };

  it('an empty condition matches anything', () => {
    expect(matchesCondition({}, ctx)).toBe(true);
    expect(matchesCondition({}, { action: 'merge' })).toBe(true);
  });

  it('ANDs every present matcher', () => {
    expect(matchesCondition({ actions: ['deploy'], environments: ['prod'] }, ctx)).toBe(true);
    expect(matchesCondition({ actions: ['deploy'], environments: ['staging'] }, ctx)).toBe(false);
    expect(matchesCondition({ agentRoles: ['coding-agent'] }, ctx)).toBe(false);
  });

  it('riskAtLeast compares by band and fails when the context has no risk', () => {
    expect(matchesCondition({ riskAtLeast: 'medium' }, ctx)).toBe(true); // high >= medium
    expect(matchesCondition({ riskAtLeast: 'critical' }, ctx)).toBe(false); // high < critical
    expect(matchesCondition({ riskAtLeast: 'low' }, { action: 'x' })).toBe(false); // no risk on ctx
  });

  it('minEstimatedCostUsd needs a cost at or above the floor', () => {
    expect(matchesCondition({ minEstimatedCostUsd: 40 }, ctx)).toBe(true);
    expect(matchesCondition({ minEstimatedCostUsd: 50 }, ctx)).toBe(false);
    expect(matchesCondition({ minEstimatedCostUsd: 1 }, { action: 'x' })).toBe(false); // no cost
  });

  it('anyTags needs an intersection', () => {
    expect(matchesCondition({ anyTags: ['secrets', 'db-migration'] }, ctx)).toBe(true);
    expect(matchesCondition({ anyTags: ['secrets'] }, ctx)).toBe(false);
    expect(matchesCondition({ anyTags: ['x'] }, { action: 'a' })).toBe(false); // no tags
  });
});

describe('evaluatePolicy', () => {
  const policy: ApprovalPolicy = {
    id: 'p',
    version: 1,
    rules: [
      {
        id: 'prod-deploy',
        when: { actions: ['deploy'], environments: ['prod'] },
        require: { approverRoles: ['tech-lead'], slaMinutes: 60, escalateTo: ['eng-manager'] },
      },
      {
        id: 'high-risk',
        when: { riskAtLeast: 'high' },
        require: { approverRoles: ['security'], minApprovals: 2, slaMinutes: 30 },
      },
      {
        id: 'disabled-rule',
        enabled: false,
        when: {},
        require: { approverRoles: ['everyone'] },
      },
    ],
  };

  it('requires no approval when nothing matches', () => {
    const result = evaluatePolicy(policy, { action: 'merge', environment: 'staging', riskLevel: 'low' });
    expect(result).toEqual({ requiresApproval: false, matchedRuleIds: [] });
  });

  it('folds multiple matched rules: union roles, max quorum, min SLA', () => {
    const result = evaluatePolicy(policy, { action: 'deploy', environment: 'prod', riskLevel: 'critical' });
    expect(result.requiresApproval).toBe(true);
    expect(result.matchedRuleIds).toEqual(['prod-deploy', 'high-risk']);
    expect(result.requirement).toEqual({
      approverRoles: ['tech-lead', 'security'], // union
      minApprovals: 2, // max(1, 2)
      slaMinutes: 30, // min(60, 30)
      escalateTo: ['eng-manager'], // union
    });
  });

  it('defaults the quorum to 1 and omits the SLA when no matched rule sets one', () => {
    const simple: ApprovalPolicy = {
      id: 'p2',
      version: 1,
      rules: [{ id: 'r', when: { actions: ['deploy'] }, require: { approverRoles: ['lead'] } }],
    };
    const result = evaluatePolicy(simple, { action: 'deploy' });
    expect(result.requirement).toEqual({ approverRoles: ['lead'], minApprovals: 1, escalateTo: [] });
    expect(result.requirement && 'slaMinutes' in result.requirement).toBe(false);
  });

  it('never matches a disabled rule', () => {
    // only the disabled catch-all could match an unknown action; it must not
    const result = evaluatePolicy(policy, { action: 'totally-unknown' });
    expect(result.requiresApproval).toBe(false);
  });
});

describe('schema validation', () => {
  it('parses a valid policy and the default policy', () => {
    expect(() => parseApprovalPolicy(defaultApprovalPolicy())).not.toThrow();
    expect(defaultApprovalPolicy().rules).toHaveLength(2);
  });

  it('rejects unknown keys, empty approver roles, and bad versions', () => {
    expect(safeParseApprovalPolicy({ id: 'p', version: 1, rules: [], extra: true }).success).toBe(false);
    expect(safeParseApprovalPolicy({ id: 'p', version: 0, rules: [] }).success).toBe(false);
    expect(
      safeParseApprovalPolicy({
        id: 'p',
        version: 1,
        rules: [{ id: 'r', when: {}, require: { approverRoles: [] } }],
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate rule ids', () => {
    const result = safeParseApprovalPolicy({
      id: 'p',
      version: 1,
      rules: [
        { id: 'dup', when: {}, require: { approverRoles: ['a'] } },
        { id: 'dup', when: {}, require: { approverRoles: ['b'] } },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('Duplicate rule id'))).toBe(true);
    }
  });
});
