import { InMemoryAuditLog, auditEvent } from '../audit';
import { toCsv, toNdjson } from '../export';

async function seed() {
  const log = new InMemoryAuditLog();
  await log.append(
    auditEvent({
      id: 'a',
      type: 'approval.opened',
      subject: { type: 'approval', id: 'appr-1' },
      actor: 'agent',
      data: { runId: 'run-7', action: 'deploy, prod' }, // comma → must be CSV-escaped
      now: new Date('2026-06-08T10:00:00.000Z'),
    }),
  );
  await log.append(
    auditEvent({
      id: 'b',
      type: 'approval.decision',
      subject: { type: 'approval', id: 'appr-1' },
      actor: 'alice',
      now: new Date('2026-06-08T10:05:00.000Z'),
    }),
  );
  return log.list();
}

describe('toNdjson', () => {
  it('emits one JSON object per line that round-trips to the events', async () => {
    const events = await seed();
    const lines = toNdjson(events).split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ id: 'a', type: 'approval.opened', hash: events[0].hash });
    expect(JSON.parse(lines[1]).prevHash).toBe(events[0].hash); // chain preserved
  });
});

describe('toCsv', () => {
  it('writes a header + a row per event, escaping cells with commas', async () => {
    const events = await seed();
    const lines = toCsv(events).split('\n');

    expect(lines[0]).toBe('sequence,id,occurredAt,type,subjectType,subjectId,actor,prevHash,hash,data');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('0,a,2026-06-08T10:00:00.000Z,approval.opened,approval,appr-1,agent,');
    expect(lines[1]).toContain('"{""runId"":""run-7"",""action"":""deploy, prod""}"'); // escaped JSON cell
    expect(lines[2]).toContain(',b,'); // second event present
  });

  it('renders an empty data object and blank actor when absent', async () => {
    const log = new InMemoryAuditLog();
    await log.append(auditEvent({ id: 'x', type: 't', subject: { type: 'approval', id: '1' } }));
    const csv = toCsv(await log.list()).split('\n');
    expect(csv[1]).toMatch(/,,/); // blank actor
    expect(csv[1]).toContain('{}'); // empty data
  });
});
