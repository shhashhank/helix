import { MockActivityEnvironment } from '@temporalio/testing';
import { currentActivityIdempotencyKey, idempotencyKey } from '../lib/temporal/idempotency-key';
import { IdempotencyGuard, InMemoryIdempotencyStore } from '../lib/idempotency';

describe('idempotencyKey (pure)', () => {
  const info = { workflowExecution: { workflowId: 'wf-1', runId: 'r-1' }, activityId: 'a-7' };

  it('combines workflowId, activityId and action; stable + action-scoped', () => {
    expect(idempotencyKey(info, 'charge')).toBe('wf-1/a-7/charge');
    expect(idempotencyKey(info, 'charge')).toBe(idempotencyKey(info, 'charge')); // stable
    expect(idempotencyKey(info, 'email')).not.toBe(idempotencyKey(info, 'charge')); // action-scoped
  });

  it('differs by activityId', () => {
    expect(idempotencyKey({ ...info, activityId: 'a-8' }, 'charge')).not.toBe(
      idempotencyKey(info, 'charge'),
    );
  });

  it('falls back gracefully when not started by a workflow', () => {
    expect(idempotencyKey({ activityId: 'a-7' }, 'charge')).toBe('a-7/charge');
  });
});

describe('currentActivityIdempotencyKey + guard inside a real activity context', () => {
  it('a retried activity dedupes its side effect via the stable key', async () => {
    const guard = new IdempotencyGuard(new InMemoryIdempotencyStore());
    let sideEffects = 0;

    type ChargeResult = { key: string; value: string; executed: boolean };

    // An activity that performs a guarded side effect keyed by its own context.
    const chargeActivity = async (): Promise<ChargeResult> => {
      const key = currentActivityIdempotencyKey('charge');
      const r = await guard.runOnce(key, () => {
        sideEffects++;
        return 'charged';
      });
      return { key, ...r };
    };

    // Same workflowId + activityId across both runs => same key (simulating a retry).
    const env = new MockActivityEnvironment({
      workflowExecution: { workflowId: 'wf-1', runId: 'r-1' },
      activityId: 'a-1',
    });
    const attempt1 = (await env.run(chargeActivity)) as ChargeResult;
    const attempt2 = (await env.run(chargeActivity)) as ChargeResult;

    expect(attempt1.key).toBe('wf-1/a-1/charge');
    expect(attempt1.executed).toBe(true);
    expect(attempt2.executed).toBe(false); // replayed, not re-charged
    expect(sideEffects).toBe(1);
  });
});
