import { NotFoundException } from '@nestjs/common';
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
    runs = { start: jest.fn().mockResolvedValue(startedRun) } as unknown as jest.Mocked<WorkflowRunService>;
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
});
