import { BadRequestException } from '@nestjs/common';
import { Client, WorkflowIdReusePolicy } from '@temporalio/client';
import { lastValueFrom } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { WorkflowDefinition, WorkflowProgress } from '@helix/workflow';
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
    query: jest.fn(),
  };
  const start = jest.fn().mockResolvedValue(handle);
  const getHandle = jest.fn().mockReturnValue(handle);
  const client = { workflow: { start, getHandle } } as unknown as Client;
  return { client, handle, start, getHandle };
}

const progress = (over: Partial<WorkflowProgress> = {}): WorkflowProgress => ({
  steps: {},
  completed: [],
  skipped: [],
  levels: [['plan'], ['code']],
  done: false,
  ...over,
});

describe('WorkflowRunService', () => {
  it('start validates, dispatches executeWorkflow, and returns the ids + trace context', async () => {
    const { client, start } = mockClient();
    const r = await new WorkflowRunService(client).start(validDef, 'run-1');

    expect(r).toEqual(
      expect.objectContaining({
        workflowId: 'run-1',
        runId: 'rid-1',
        traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
        traceparent: expect.stringMatching(/^00-/),
      }),
    );
    expect(start).toHaveBeenCalledWith(
      'executeWorkflow',
      expect.objectContaining({ workflowId: 'run-1', taskQueue: 'helix-workflows', args: [validDef] }),
    );
  });

  it('attaches the run correlation as a Temporal memo and returns its trace id', async () => {
    const { client, start } = mockClient();
    const correlation = {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      sampled: true,
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    };
    const r = await new WorkflowRunService(client).start(validDef, 'run-1', correlation);

    expect(r.traceId).toBe(correlation.traceId);
    expect(r.traceparent).toBe(correlation.traceparent);
    expect(start.mock.calls[0][1].memo).toEqual({
      traceId: correlation.traceId,
      traceparent: correlation.traceparent,
      spanId: correlation.spanId,
    });
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

  it('get surfaces the run trace id/traceparent recorded in the memo', async () => {
    const { client, handle } = mockClient();
    handle.describe.mockResolvedValue({
      workflowId: 'run-1',
      runId: 'rid-1',
      status: { name: 'RUNNING', code: 1 },
      startTime: new Date('2026-01-01T00:00:00Z'),
      closeTime: undefined,
      memo: {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      },
    });
    const r = await new WorkflowRunService(client).get('run-1');
    expect(r.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(r.traceparent).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
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

  it('streamProgress polls the query, emits only on change, and completes when done', async () => {
    const { client, handle } = mockClient();
    const running = progress({ completed: ['plan'] });
    const finished = progress({ completed: ['plan', 'code'], done: true });
    handle.query
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running) // unchanged → filtered out
      .mockResolvedValue(finished);

    const emitted = await lastValueFrom(
      new WorkflowRunService(client).streamProgress('run-1', 5).pipe(toArray()),
    );

    expect(emitted).toEqual([running, finished]); // duplicate dropped; ends after the done snapshot
    expect(handle.query).toHaveBeenCalledWith('workflowProgress');
  });
});
