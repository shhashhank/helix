import {
  InMemoryToolPolicyAuditSink,
  PolicyRule,
  ToolAccessDeniedError,
  ToolPolicy,
  ToolPolicyEnforcer,
  ToolRequest,
  evaluatePolicy,
} from '../policy';

const req = (over: Partial<ToolRequest> = {}): ToolRequest => ({
  orgId: 'org1',
  agentRole: 'coding',
  serverId: 'gh',
  toolName: 'create_pr',
  ...over,
});

const policy = (rules: PolicyRule[], defaultEffect?: ToolPolicy['defaultEffect']): ToolPolicy => ({
  defaultEffect,
  rules,
});

describe('evaluatePolicy', () => {
  it('defaults to deny when no rule matches (fail-closed)', () => {
    expect(evaluatePolicy(policy([]), req()).effect).toBe('deny');
    expect(evaluatePolicy(policy([], 'allow'), req()).effect).toBe('allow'); // configurable default
  });

  it('allows a matching allow rule', () => {
    const d = evaluatePolicy(policy([{ effect: 'allow', serverId: 'gh', toolName: 'create_pr' }]), req());
    expect(d.effect).toBe('allow');
    expect(d.matchedRule?.effect).toBe('allow');
  });

  it('deny beats allow regardless of order (most-restrictive wins)', () => {
    const rules: PolicyRule[] = [
      { effect: 'allow', serverId: 'gh' },
      { effect: 'deny', toolName: 'create_pr', id: 'no-prs' },
    ];
    const d = evaluatePolicy(policy(rules), req());
    expect(d.effect).toBe('deny');
    expect(d.matchedRule?.id).toBe('no-prs');
  });

  it('require_approval beats allow but loses to deny', () => {
    const base: PolicyRule[] = [
      { effect: 'allow', serverId: 'gh' },
      { effect: 'require_approval', toolName: 'create_pr' },
    ];
    expect(evaluatePolicy(policy(base), req()).effect).toBe('require_approval');
    expect(evaluatePolicy(policy([...base, { effect: 'deny', toolName: 'create_pr' }]), req()).effect).toBe('deny');
  });

  it('omitted rule fields are wildcards; specified fields must match', () => {
    // role-scoped: only "coding" may use gh
    const rules: PolicyRule[] = [{ effect: 'allow', agentRole: 'coding', serverId: 'gh' }];
    expect(evaluatePolicy(policy(rules), req({ agentRole: 'coding' })).effect).toBe('allow');
    expect(evaluatePolicy(policy(rules), req({ agentRole: 'planning' })).effect).toBe('deny'); // no match → default
  });

  it('supports `*` and prefix globs for tool names', () => {
    expect(evaluatePolicy(policy([{ effect: 'allow', toolName: '*' }]), req({ toolName: 'anything' })).effect).toBe('allow');
    const glob = policy([{ effect: 'allow', toolName: 'read_*' }]);
    expect(evaluatePolicy(glob, req({ toolName: 'read_file' })).effect).toBe('allow');
    expect(evaluatePolicy(glob, req({ toolName: 'write_file' })).effect).toBe('deny');
  });

  it('scopes by org', () => {
    const rules: PolicyRule[] = [{ effect: 'allow', orgId: 'org1' }];
    expect(evaluatePolicy(policy(rules), req({ orgId: 'org1' })).effect).toBe('allow');
    expect(evaluatePolicy(policy(rules), req({ orgId: 'org2' })).effect).toBe('deny');
  });
});

describe('ToolPolicyEnforcer', () => {
  it('check audits the decision (allow and deny alike)', async () => {
    const audit = new InMemoryToolPolicyAuditSink();
    const enforcer = new ToolPolicyEnforcer(policy([{ effect: 'allow', serverId: 'gh' }]), audit);
    await enforcer.check(req());
    await enforcer.check(req({ serverId: 'other' }));
    expect(audit.events).toHaveLength(2);
    expect(audit.events[0].decision.effect).toBe('allow');
    expect(audit.events[1].decision.effect).toBe('deny');
    expect(typeof audit.events[0].at).toBe('string');
  });

  it('enforce blocks a denied call (throws) and audits it', async () => {
    const audit = new InMemoryToolPolicyAuditSink();
    const enforcer = new ToolPolicyEnforcer(policy([{ effect: 'deny', toolName: 'create_pr' }]), audit);
    await expect(enforcer.enforce(req())).rejects.toBeInstanceOf(ToolAccessDeniedError);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0].decision.effect).toBe('deny');
  });

  it('enforce returns the decision for allow and require_approval (no throw)', async () => {
    const enforcer = new ToolPolicyEnforcer(
      policy([
        { effect: 'allow', toolName: 'read_file' },
        { effect: 'require_approval', toolName: 'create_pr' },
      ]),
    );
    expect((await enforcer.enforce(req({ toolName: 'read_file' }))).effect).toBe('allow');
    expect((await enforcer.enforce(req({ toolName: 'create_pr' }))).effect).toBe('require_approval');
  });
});
