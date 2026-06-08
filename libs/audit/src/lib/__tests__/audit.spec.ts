import {
  AuditEvent,
  GENESIS_HASH,
  InMemoryAuditLog,
  auditEvent,
  hashEvent,
  verifyChain,
} from '../audit';

const draft = (over: Partial<Parameters<typeof auditEvent>[0]> = {}) =>
  auditEvent({
    type: 'approval.opened',
    subject: { type: 'approval', id: 'appr-1' },
    actor: 'deployment-agent',
    data: { runId: 'run-7' },
    now: new Date('2026-06-08T10:00:00.000Z'),
    ...over,
  });

describe('auditEvent', () => {
  it('builds a draft with an id and ISO timestamp', () => {
    const d = draft({ id: 'aud-1' });
    expect(d).toMatchObject({
      id: 'aud-1',
      type: 'approval.opened',
      occurredAt: '2026-06-08T10:00:00.000Z',
      subject: { type: 'approval', id: 'appr-1' },
    });
  });
});

describe('InMemoryAuditLog — append + chain', () => {
  it('chains each event to the previous via prevHash/hash and freezes it', async () => {
    const log = new InMemoryAuditLog();
    const a = await log.append(draft({ id: 'a' }));
    const b = await log.append(draft({ id: 'b', type: 'approval.decision' }));

    expect(a.sequence).toBe(0);
    expect(a.prevHash).toBe(GENESIS_HASH);
    expect(a.hash).toBe(hashEvent(GENESIS_HASH, a));
    expect(b.sequence).toBe(1);
    expect(b.prevHash).toBe(a.hash); // linked
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('verifies an intact chain', async () => {
    const log = new InMemoryAuditLog();
    await log.append(draft({ id: 'a' }));
    await log.append(draft({ id: 'b' }));
    await log.append(draft({ id: 'c' }));
    expect(await log.verify()).toEqual({ ok: true });
  });
});

describe('verifyChain — tamper evidence', () => {
  it('detects a mutated event payload', async () => {
    const log = new InMemoryAuditLog();
    await log.append(draft({ id: 'a' }));
    await log.append(draft({ id: 'b', data: { runId: 'run-7' } }));
    const events = await log.list();

    // forge the second event's data without recomputing the hash
    const tampered: AuditEvent[] = [events[0], { ...events[1], data: { runId: 'run-HACKED' } }];
    const result = verifyChain(tampered);
    expect(result).toMatchObject({ ok: false, brokenAt: 1, reason: 'hash mismatch' });
  });

  it('detects a dropped/reordered event via the prevHash link', async () => {
    const log = new InMemoryAuditLog();
    const a = await log.append(draft({ id: 'a' }));
    await log.append(draft({ id: 'b' }));
    const c = await log.append(draft({ id: 'c' }));

    // drop 'b' — c.prevHash no longer matches a.hash, and sequence is off
    const result = verifyChain([a, c]);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(1);
  });
});

describe('InMemoryAuditLog — list', () => {
  it('filters by subject and type, and limits to the most recent N', async () => {
    const log = new InMemoryAuditLog();
    await log.append(draft({ id: 'a', subject: { type: 'approval', id: 'x' }, type: 'approval.opened' }));
    await log.append(draft({ id: 'b', subject: { type: 'approval', id: 'x' }, type: 'approval.decision' }));
    await log.append(draft({ id: 'c', subject: { type: 'approval', id: 'y' }, type: 'approval.opened' }));

    expect((await log.list({ subjectId: 'x' })).map((e) => e.id)).toEqual(['a', 'b']);
    expect((await log.list({ type: 'approval.opened' })).map((e) => e.id)).toEqual(['a', 'c']);
    expect((await log.list({ limit: 1 })).map((e) => e.id)).toEqual(['c']); // most recent
    expect((await log.list()).map((e) => e.id)).toEqual(['a', 'b', 'c']); // chronological
  });
});
