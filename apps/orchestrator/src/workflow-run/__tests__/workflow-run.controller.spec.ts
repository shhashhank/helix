import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { lastValueFrom, of } from 'rxjs';
import { toArray } from 'rxjs/operators';
import request from 'supertest';
import { WorkflowRunController } from '../workflow-run.controller';
import { WorkflowRunService } from '../workflow-run.service';

const workflow = { name: 'wf', steps: [{ id: 'a', agentRole: 'x' }], edges: [] };

describe('WorkflowRunController', () => {
  let app: INestApplication;
  let controller: WorkflowRunController;
  let service: jest.Mocked<WorkflowRunService>;

  beforeEach(async () => {
    service = {
      start: jest.fn(),
      get: jest.fn(),
      cancel: jest.fn(),
      retry: jest.fn(),
      streamProgress: jest.fn(),
    } as unknown as jest.Mocked<WorkflowRunService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowRunController],
      providers: [{ provide: WorkflowRunService, useValue: service }],
    }).compile();

    controller = moduleRef.get(WorkflowRunController);
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const startedRun = {
    workflowId: 'run-1',
    runId: 'rid-1',
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  };

  it('POST /runs starts a run and returns + echoes the run trace context', async () => {
    service.start.mockResolvedValue(startedRun);
    const res = await request(app.getHttpServer())
      .post('/runs')
      .send({ workflow, workflowId: 'run-1' })
      .expect(201);
    expect(res.body).toEqual(startedRun);
    expect(res.headers.traceparent).toBe(startedRun.traceparent);
    expect(service.start).toHaveBeenCalledWith(
      workflow,
      'run-1',
      expect.objectContaining({ traceId: expect.any(String), traceparent: expect.any(String) }),
    );
  });

  it('POST /runs continues an inbound traceparent (same trace id)', async () => {
    service.start.mockResolvedValue(startedRun);
    const inbound = '00-4bf92f3577b34da6a3ce929d0e0e4736-aaaaaaaaaaaaaaaa-01';
    await request(app.getHttpServer())
      .post('/runs')
      .set('traceparent', inbound)
      .send({ workflow })
      .expect(201);
    const correlation = service.start.mock.calls[0][2];
    expect(correlation?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(correlation?.spanId).not.toBe('aaaaaaaaaaaaaaaa'); // our own root span
  });

  it('GET /runs/:id returns the status', async () => {
    service.get.mockResolvedValue({ workflowId: 'run-1', runId: 'rid-1', status: 'RUNNING' });
    const res = await request(app.getHttpServer()).get('/runs/run-1').expect(200);
    expect(res.body.status).toBe('RUNNING');
    expect(service.get).toHaveBeenCalledWith('run-1');
  });

  it('POST /runs/:id/cancel returns 202', async () => {
    service.cancel.mockResolvedValue(undefined);
    await request(app.getHttpServer()).post('/runs/run-1/cancel').expect(202);
    expect(service.cancel).toHaveBeenCalledWith('run-1');
  });

  it('POST /runs/:id/retry retries the run with a fresh run trace context', async () => {
    service.retry.mockResolvedValue({ ...startedRun, runId: 'rid-2' });
    const res = await request(app.getHttpServer())
      .post('/runs/run-1/retry')
      .send({ workflow })
      .expect(201);
    expect(res.body).toEqual({ ...startedRun, runId: 'rid-2' });
    expect(res.headers.traceparent).toBe(startedRun.traceparent);
    expect(service.retry).toHaveBeenCalledWith(
      'run-1',
      workflow,
      expect.objectContaining({ traceId: expect.any(String), traceparent: expect.any(String) }),
    );
  });

  it('GET /runs/:id/stream maps progress snapshots to SSE message events', async () => {
    const p1 = { steps: {}, completed: ['plan'], skipped: [], levels: [['plan']], done: false };
    const p2 = { steps: {}, completed: ['plan'], skipped: [], levels: [['plan']], done: true };
    service.streamProgress.mockReturnValue(of(p1, p2));

    const events = await lastValueFrom(controller.stream('run-1').pipe(toArray()));

    expect(events).toEqual([{ data: p1 }, { data: p2 }]);
    expect(service.streamProgress).toHaveBeenCalledWith('run-1');
  });
});
