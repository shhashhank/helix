/**
 * Idempotency-key derivation for Temporal activities (HELIX-72). The key must be
 * **stable across retries** of the same activity so an {@link IdempotencyGuard}
 * dedupes a retried step's side effects. Temporal's `workflowId` + `activityId`
 * are stable across retries (only `attempt` increments), so they form the key
 * base; the `action` name disambiguates multiple side effects within one step.
 */
import { Context, Info } from '@temporalio/activity';

/** Pure key builder — testable without an activity context. */
export function idempotencyKey(
  info: Pick<Info, 'workflowExecution' | 'activityId'>,
  action: string,
): string {
  return [info.workflowExecution?.workflowId, info.activityId, action]
    .filter((part): part is string => Boolean(part))
    .join('/');
}

/**
 * Build the idempotency key for a named side effect from the *current* activity's
 * context. Call only inside a running activity (throws otherwise, via
 * `Context.current()`).
 */
export function currentActivityIdempotencyKey(action: string): string {
  return idempotencyKey(Context.current().info, action);
}
