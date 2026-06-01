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

  it('POST /runs starts a run', async () => {
    service.start.mockResolvedValue({ workflowId: 'run-1', runId: 'rid-1' });
    const res = await request(app.getHttpServer())
      .post('/runs')
      .send({ workflow, workflowId: 'run-1' })
      .expect(201);
    expect(res.body).toEqual({ workflowId: 'run-1', runId: 'rid-1' });
    expect(service.start).toHaveBeenCalledWith(workflow, 'run-1');
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

  it('POST /runs/:id/retry retries the run', async () => {
    service.retry.mockResolvedValue({ workflowId: 'run-1', runId: 'rid-2' });
    const res = await request(app.getHttpServer())
      .post('/runs/run-1/retry')
      .send({ workflow })
      .expect(201);
    expect(res.body).toEqual({ workflowId: 'run-1', runId: 'rid-2' });
    expect(service.retry).toHaveBeenCalledWith('run-1', workflow);
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
