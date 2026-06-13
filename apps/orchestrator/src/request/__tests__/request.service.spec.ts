import { NotFoundException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { toArray } from 'rxjs/operators';
import type { AuthPrincipal } from '@helix/auth';
import { WorkflowRunService } from '../../workflow-run/workflow-run.service';
import { RequestService } from '../request.service';
import { InMemoryRequestStore } from '../request.store';

const principal = (over: Partial<AuthPrincipal> = {}): AuthPrincipal => ({
  userId: 'u1',
  roles: [],
  orgId: 'acme',
  ...over,
});

const startedRun = {
  workflowId: 'run-1',
  runId: 'rid-1',
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
};

describe('RequestService', () => {
  let store: InMemoryRequestStore;
  let runs: jest.Mocked<WorkflowRunService>;
  let service: RequestService;

  beforeEach(() => {
    store = new InMemoryRequestStore();
    runs = {
      start: jest.fn().mockResolvedValue(startedRun),
      get: jest.fn(),
      streamProgress: jest.fn(),
      progress: jest.fn(),
    } as unknown as jest.Mocked<WorkflowRunService>;
    service = new RequestService(store, runs);
  });

  it('submit starts a run with the default pipeline and records the request', async () => {
    const req = await service.submit({ title: 'My app', prompt: 'build X' }, principal());

    const def = runs.start.mock.calls[0][0];
    expect(def.steps.map((s) => s.id)).toEqual(['plan', 'code', 'review', 'test', 'deploy']);
    expect(req).toEqual(
      expect.objectContaining({
        title: 'My app',
        prompt: 'build X',
        submittedBy: 'u1',
        orgId: 'acme',
        status: 'submitted',
        workflowId: 'run-1',
        runId: 'rid-1',
        traceId: startedRun.traceId,
      }),
    );
    expect(req.id).toMatch(/^req-/);
    expect((await service.get(req.id, principal())).id).toBe(req.id); // persisted
  });

  it('submit uses an explicit workflow when one is provided', async () => {
    const workflow = { name: 'custom', steps: [{ id: 'only', agentRole: 'x' }], edges: [] };
    await service.submit({ title: 'T', prompt: 'p', workflow }, principal());
    expect(runs.start.mock.calls[0][0]).toEqual(workflow);
  });

  it('maps a principal without an org to the shared (null) namespace', async () => {
    const req = await service.submit({ title: 'T', prompt: 'p' }, principal({ orgId: undefined }));
    expect(req.orgId).toBeNull();
  });

  it('list is scoped to the caller org, newest-first, with mineOnly', async () => {
    await service.submit({ title: 'a', prompt: 'p' }, principal({ userId: 'u1', orgId: 'acme' }));
    await service.submit({ title: 'b', prompt: 'p' }, principal({ userId: 'u2', orgId: 'acme' }));
    await service.submit({ title: 'c', prompt: 'p' }, principal({ userId: 'u9', orgId: 'globex' }));

    expect(await service.list(principal({ orgId: 'acme' }))).toHaveLength(2); // not globex's
    expect(await service.list(principal({ userId: 'u1', orgId: 'acme' }), true)).toHaveLength(1); // only mine
  });

  it('get is tenant-scoped — another org (or unknown id) is a 404', async () => {
    const req = await service.submit({ title: 't', prompt: 'p' }, principal({ orgId: 'acme' }));
    await expect(service.get(req.id, principal({ orgId: 'globex' }))).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.get('req-nope', principal())).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('dashboard (HELIX-146)', () => {
    const runStatus = { workflowId: 'run-1', runId: 'rid-1', status: 'RUNNING' };

    it('runStatus returns the request run status, tenant-scoped', async () => {
      const req = await service.submit({ title: 't', prompt: 'p' }, principal({ orgId: 'acme' }));
      runs.get.mockResolvedValue(runStatus);

      expect(await service.runStatus(req.id, principal({ orgId: 'acme' }))).toEqual(runStatus);
      expect(runs.get).toHaveBeenCalledWith('run-1');
      await expect(service.runStatus(req.id, principal({ orgId: 'globex' }))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('overview joins each org request with its run status', async () => {
      await service.submit({ title: 'a', prompt: 'p' }, principal({ orgId: 'acme' }));
      await service.submit({ title: 'b', prompt: 'p' }, principal({ orgId: 'acme' }));
      runs.get.mockResolvedValue(runStatus);

      const items = await service.overview(principal({ orgId: 'acme' }));
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({ request: expect.objectContaining({ orgId: 'acme' }), run: runStatus });
    });

    it('streamProgress emits the run progress for a valid request', async () => {
      const req = await service.submit({ title: 't', prompt: 'p' }, principal({ orgId: 'acme' }));
      const p1 = { steps: {}, completed: [], skipped: [], levels: [], done: false };
      const p2 = { ...p1, done: true };
      runs.streamProgress.mockReturnValue(of(p1, p2));

      const emitted = await lastValueFrom(service.streamProgress(req.id, principal({ orgId: 'acme' })).pipe(toArray()));
      expect(emitted).toEqual([p1, p2]);
      expect(runs.streamProgress).toHaveBeenCalledWith('run-1');
    });

    it('streamProgress errors for a cross-tenant request (no stream)', async () => {
      const req = await service.submit({ title: 't', prompt: 'p' }, principal({ orgId: 'acme' }));
      await expect(
        lastValueFrom(service.streamProgress(req.id, principal({ orgId: 'globex' }))),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(runs.streamProgress).not.toHaveBeenCalled();
    });

    it('artifacts extracts the run outputs for a request, tenant-scoped', async () => {
      const req = await service.submit({ title: 't', prompt: 'p' }, principal({ orgId: 'acme' }));
      runs.progress.mockResolvedValue({
        steps: { deploy: { id: 'deploy', ran: true, status: 'success', output: { liveUrl: 'https://app' } } },
        completed: ['deploy'],
        skipped: [],
        levels: [['deploy']],
        done: true,
      });

      expect(await service.artifacts(req.id, principal({ orgId: 'acme' }))).toEqual({ deployment: { url: 'https://app' } });
      expect(runs.progress).toHaveBeenCalledWith('run-1');
      await expect(service.artifacts(req.id, principal({ orgId: 'globex' }))).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
