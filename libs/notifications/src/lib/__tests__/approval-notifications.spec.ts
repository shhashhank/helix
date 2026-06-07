import { approvalRequestedNotification } from '../approval-notifications';
import { InMemoryRecipientDirectory, recipientsForRoles } from '../recipients';
import { Recipient } from '../notification';

describe('recipientsForRoles', () => {
  it('unions recipients across roles, de-duped by channel+address', async () => {
    const lead: Recipient = { channel: 'email', address: 'lead@acme.test' };
    const slack: Recipient = { channel: 'slack', address: '#deploys' };
    const dir = new InMemoryRecipientDirectory({
      'tech-lead': [lead, slack],
      security: [slack, { channel: 'email', address: 'sec@acme.test' }], // slack duplicated
    });

    const recipients = await recipientsForRoles(dir, ['tech-lead', 'security']);
    expect(recipients).toEqual([lead, slack, { channel: 'email', address: 'sec@acme.test' }]);
  });

  it('returns empty for unknown roles', async () => {
    expect(await recipientsForRoles(new InMemoryRecipientDirectory(), ['nobody'])).toEqual([]);
  });
});

describe('approvalRequestedNotification', () => {
  it('builds the subject/body/recipients/data for a requested approval', () => {
    const recipients: Recipient[] = [{ channel: 'in_app', address: 'user-7' }];
    const ntf = approvalRequestedNotification(
      {
        requestId: 'appr-1',
        action: 'deploy prod',
        runId: 'run-7',
        approverRoles: ['tech-lead', 'security'],
        minApprovals: 2,
        expiresAt: '2026-06-08T11:00:00.000Z',
        reason: 'matched prod-deploy',
      },
      recipients,
      { now: new Date('2026-06-08T10:00:00.000Z') },
    );

    expect(ntf.type).toBe('approval.requested');
    expect(ntf.id).toBe('ntf-appr-1-requested');
    expect(ntf.subject).toBe('Approval needed: deploy prod');
    expect(ntf.body).toContain('2 approvals from tech-lead, security');
    expect(ntf.body).toContain('Run run-7.');
    expect(ntf.body).toContain('Respond by 2026-06-08T11:00:00.000Z.');
    expect(ntf.recipients).toBe(recipients);
    expect(ntf.data).toEqual({ requestId: 'appr-1', runId: 'run-7', action: 'deploy prod' });
  });

  it('singularizes a single-approval quorum and omits absent fields', () => {
    const ntf = approvalRequestedNotification(
      { requestId: 'a', action: 'merge', approverRoles: ['lead'], minApprovals: 1 },
      [],
    );
    expect(ntf.body).toContain('1 approval from lead.');
    expect(ntf.body).not.toContain('Run');
    expect(ntf.body).not.toContain('Respond by');
  });
});
