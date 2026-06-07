import { Inject, Injectable } from '@nestjs/common';
import { Client } from '@temporalio/client';
import { ApprovalSignalPayload, submitApprovalDecision } from '@helix/workflow/temporal-client';
import { TEMPORAL_CLIENT } from '../temporal/temporal.constants';

/** DI token for the {@link WorkflowSignaler}. */
export const WORKFLOW_SIGNALER = Symbol('WORKFLOW_SIGNALER');

/**
 * The outbound seam to the durable workflow: deliver a resolved approval decision
 * to a paused run so it resumes. Abstracted behind an interface so the approval
 * service is testable without a Temporal client.
 */
export interface WorkflowSignaler {
  signalDecision(workflowId: string, payload: ApprovalSignalPayload): Promise<void>;
}

/** Drives the decision into Temporal via the `awaitApproval` signal (HELIX-74/76). */
@Injectable()
export class TemporalWorkflowSignaler implements WorkflowSignaler {
  constructor(@Inject(TEMPORAL_CLIENT) private readonly client: Client) {}

  signalDecision(workflowId: string, payload: ApprovalSignalPayload): Promise<void> {
    return submitApprovalDecision(this.client, workflowId, payload);
  }
}
