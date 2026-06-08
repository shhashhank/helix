import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditLog, InMemoryAuditLog, auditEvent } from '@helix/audit';
import request from 'supertest';
import { AuditController } from '../audit.controller';
import { AUDIT_LOG } from '../audit.tokens';

describe('AuditController', () => {
  let app: INestApplication;
  let log: AuditLog;

  beforeEach(async () => {
    log = new InMemoryAuditLog();
    await log.append(auditEvent({ id: 'a', type: 'approval.opened', subject: { type: 'approval', id: 'appr-1' } }));
    await log.append(auditEvent({ id: 'b', type: 'approval.decision', subject: { type: 'approval', id: 'appr-1' } }));
    await log.append(auditEvent({ id: 'c', type: 'approval.opened', subject: { type: 'approval', id: 'appr-2' } }));

    const moduleRef = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AUDIT_LOG, useValue: log }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /audit filters by subject and type', async () => {
    const bySubject = await request(app.getHttpServer()).get('/audit?subjectId=appr-1').expect(200);
    expect(bySubject.body.map((e: { id: string }) => e.id)).toEqual(['a', 'b']);

    const byType = await request(app.getHttpServer()).get('/audit?type=approval.opened').expect(200);
    expect(byType.body.map((e: { id: string }) => e.id)).toEqual(['a', 'c']);
  });

  it('GET /audit?limit returns the most recent N', async () => {
    const res = await request(app.getHttpServer()).get('/audit?limit=1').expect(200);
    expect(res.body.map((e: { id: string }) => e.id)).toEqual(['c']);
  });

  it('GET /audit/verify reports an intact chain (resolves before /:no-such-route)', async () => {
    const res = await request(app.getHttpServer()).get('/audit/verify').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('GET /audit/export defaults to NDJSON with a download header', async () => {
    const res = await request(app.getHttpServer()).get('/audit/export').expect(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    expect(res.headers['content-disposition']).toContain('audit.ndjson');
    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).id).toBe('a');
  });

  it('GET /audit/export?format=csv returns CSV, honoring the filter', async () => {
    const res = await request(app.getHttpServer()).get('/audit/export?format=csv&subjectId=appr-1').expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('audit.csv');
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toContain('sequence,id,occurredAt,type');
    expect(lines).toHaveLength(3); // header + 2 (appr-1 only)
  });
});
