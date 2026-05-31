/**
 * Resume-on-decision handler (HELIX-76) — the *inbound* half of human-in-the-loop.
 * After a workflow pauses and publishes an approval request (HELIX-74 + HELIX-75),
 * these client helpers deliver a human's decision back into the paused run
 * (resuming it) and read whether a run is still awaiting sign-off.
 *
 * Client-side (not workflow code): it imports the signal/query *definitions* from
 * {@link ./approval} and drives them through a Temporal {@link Client}.
 */
import { Client } from '@temporalio/client';
import {
  ApprovalSignalPayload,
  ApprovalStatus,
  approvalSignal,
  approvalStatusQuery,
} from './approval';

/**
 * Deliver a human's decision into a paused workflow, resuming it. Throws if the
 * workflow isn't running (e.g. it already decided or timed out — the decision
 * arrived too late).
 */
export async function submitApprovalDecision(
  client: Client,
  workflowId: string,
  decision: ApprovalSignalPayload,
): Promise<void> {
  await client.workflow.getHandle(workflowId).signal(approvalSignal, decision);
}

/**
 * Read a run's approval status: `{ state: 'pending' }` while it waits, or
 * `{ state: 'decided', decision, decidedBy?, timedOut? }` once resolved
 * (queryable even after the workflow has completed).
 */
export async function getApprovalStatus(
  client: Client,
  workflowId: string,
): Promise<ApprovalStatus> {
  return client.workflow.getHandle(workflowId).query(approvalStatusQuery);
}
