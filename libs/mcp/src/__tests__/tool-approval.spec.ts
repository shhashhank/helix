import { ToolAccessDeniedError, ToolPolicyEnforcer, ToolRequest } from '../policy';
import {
  ApprovalGatedToolPolicy,
  ApprovalOutcome,
  ToolApprovalGateway,
  ToolApprovalRejectedError,
  ToolApprovalRequest,
} from '../tool-approval';

const req = (over: Partial<ToolRequest> = {}): ToolRequest => ({
  orgId: 'org1',
  agentRole: 'coding',
  serverId: 'gh',
  toolName: 'create_pr',
  ...over,
});

/** Records the requests it gets and answers with a fixed outcome. */
function gateway(outcome: ApprovalOutcome) {
  const seen: ToolApprovalRequest[] = [];
  const gw: ToolApprovalGateway = {
    requestApproval: async (r) => {
      seen.push(r);
      return outcome;
    },
  };
  return { gw, seen };
}

describe('ApprovalGatedToolPolicy', () => {
  it('lets a plain allow through without asking for approval', async () => {
    const enforcer = new ToolPolicyEnforcer({ rules: [{ effect: 'allow', serverId: 'gh' }] });
    const { gw, seen } = gateway('approved');
    const auth = await new ApprovalGatedToolPolicy(enforcer, gw).authorize(req());

    expect(auth).toMatchObject({ allowed: true, viaApproval: false });
    expect(seen).toHaveLength(0); // approval service untouched
  });

  it('blocks a denied call before any approval (throws ToolAccessDeniedError)', async () => {
    const enforcer = new ToolPolicyEnforcer({ rules: [{ effect: 'deny', toolName: 'create_pr' }] });
    const { gw, seen } = gateway('approved');
    await expect(new ApprovalGatedToolPolicy(enforcer, gw).authorize(req())).rejects.toBeInstanceOf(
      ToolAccessDeniedError,
    );
    expect(seen).toHaveLength(0);
  });

  it('routes a require_approval tool to the gateway and proceeds when approved', async () => {
    const enforcer = new ToolPolicyEnforcer({
      rules: [{ effect: 'require_approval', toolName: 'create_pr', id: 'risky-pr' }],
    });
    const { gw, seen } = gateway('approved');
    const auth = await new ApprovalGatedToolPolicy(enforcer, gw).authorize(req());

    expect(auth).toMatchObject({ allowed: true, viaApproval: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].request.toolName).toBe('create_pr');
    expect(seen[0].reason).toContain('require_approval');
    expect((seen[0].context as { rule: { id: string } }).rule.id).toBe('risky-pr');
  });

  it('blocks when the approver rejects (throws ToolApprovalRejectedError)', async () => {
    const enforcer = new ToolPolicyEnforcer({
      rules: [{ effect: 'require_approval', toolName: 'create_pr' }],
    });
    const { gw } = gateway('rejected');
    await expect(new ApprovalGatedToolPolicy(enforcer, gw).authorize(req())).rejects.toBeInstanceOf(
      ToolApprovalRejectedError,
    );
  });
});
