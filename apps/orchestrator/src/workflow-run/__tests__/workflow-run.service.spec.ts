import { BadRequestException } from '@nestjs/common';
import { Client, WorkflowIdReusePolicy } from '@temporalio/client';
import { WorkflowDefinition } from '@helix/workflow';
import { WorkflowRunService } from '../workflow-run.service';

const validDef: WorkflowDefinition = {
  name: 'wf',
  steps: [{ id: 'a', agentRole: 'x' }],
  edges: [],
};

function mockClient() {
  const handle = {
    workflowId: 'run-1',
    firstExecutionRunId: 'rid-1',
    describe: jest.fn().mockResolvedValue({
      workflowId: 'run-1',
      runId: 'rid-1',
      status: { name: 'RUNNING', code: 1 },
      startTime: new Date('2026-01-01T00:00:00Z'),
      closeTime: undefined,
    }),
    cancel: jest.fn().mockResolvedValue(undefined),
  };
  const start = jest.fn().mockResolvedValue(handle);
  const getHandle = jest.fn().mockReturnValue(handle);
  const client = { workflow: { start, getHandle } } as unknown as Client;
  return { client, handle, start, getHandle };
}

describe('WorkflowRunService', () => {
  it('start validates, dispatches executeWorkflow, and returns the ids', async () => {
    const { client, start } = mockClient();
    const r = await new WorkflowRunService(client).start(validDef, 'run-1');

    expect(r).toEqual({ workflowId: 'run-1', runId: 'rid-1' });
    expect(start).toHaveBeenCalledWith(
      'executeWorkflow',
      expect.objectContaining({ workflowId: 'run-1', taskQueue: 'helix-workflows', args: [validDef] }),
    );
  });

  it('auto-generates a workflowId when omitted', async () => {
    const { client, start } = mockClient();
    await new WorkflowRunService(client).start(validDef);
    expect(start.mock.calls[0][1].workflowId).toMatch(/^run-/);
  });

  it('rejects an invalid workflow with 400 and never dispatches', async () => {
    const { client, start } = mockClient();
    await expect(
      new WorkflowRunService(client).start({ name: '', steps: [], edges: [] } as WorkflowDefinition),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(start).not.toHaveBeenCalled();
  });

  it('get maps describe() to a RunStatus', async () => {
    const { client, getHandle } = mockClient();
    const r = await new WorkflowRunService(client).get('run-1');
    expect(getHandle).toHaveBeenCalledWith('run-1');
    expect(r).toEqual({
      workflowId: 'run-1',
      runId: 'rid-1',
      status: 'RUNNING',
      startTime: '2026-01-01T00:00:00.000Z',
      closeTime: undefined,
    });
  });

  it('cancel requests cancellation on the handle', async () => {
    const { client, handle, getHandle } = mockClient();
    await new WorkflowRunService(client).cancel('run-1');
    expect(getHandle).toHaveBeenCalledWith('run-1');
    expect(handle.cancel).toHaveBeenCalled();
  });

  it('retry re-starts under the same id with AllowDuplicateFailedOnly', async () => {
    const { client, start } = mockClient();
    await new WorkflowRunService(client).retry('run-1', validDef);
    const opts = start.mock.calls[0][1];
    expect(opts.workflowId).toBe('run-1');
    expect(opts.workflowIdReusePolicy).toBe(WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY);
  });
});
