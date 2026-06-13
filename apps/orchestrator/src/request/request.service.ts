import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthPrincipal } from '@helix/auth';
import { type TenantScope, belongsToTenant, tenantScope } from '@helix/tenancy';
import type { WorkflowDefinition } from '@helix/workflow';
import { WorkflowRunService } from '../workflow-run/workflow-run.service';
import { BuildRequest } from './request.model';
import { REQUEST_STORE, RequestStore } from './request.store';
import { requestToWorkflow } from './request.workflow';

export interface SubmitBuildRequest {
  title: string;
  prompt: string;
  /** Optional explicit workflow DSL; defaults to the standard delivery pipeline. */
  workflow?: WorkflowDefinition;
}

/**
 * Build-request submission (HELIX-145): turn a user's request into a workflow run
 * and record the link, scoped to the submitter's org. Reuses the run service (so
 * the request's run gets the same validation + W3C trace id), the auth principal
 * (HELIX-142) for ownership, and tenant scoping (HELIX-143) for reads.
 */
@Injectable()
export class RequestService {
  constructor(
    @Inject(REQUEST_STORE) private readonly store: RequestStore,
    private readonly runs: WorkflowRunService,
  ) {}

  async submit(input: SubmitBuildRequest, principal: AuthPrincipal): Promise<BuildRequest> {
    const id = `req-${randomUUID()}`;
    const def = input.workflow ?? requestToWorkflow({ id });
    // start() validates the workflow (400 on a bad explicit one) and mints the run's trace context.
    const started = await this.runs.start(def);
    const request: BuildRequest = {
      id,
      orgId: principal.orgId ?? null,
      submittedBy: principal.userId,
      title: input.title,
      prompt: input.prompt,
      status: 'submitted',
      workflowId: started.workflowId,
      runId: started.runId,
      traceId: started.traceId,
      createdAt: new Date().toISOString(),
    };
    await this.store.put(request);
    return request;
  }

  /** The caller org's requests (newest first); `mineOnly` narrows to the caller. */
  list(principal: AuthPrincipal, mineOnly = false): Promise<BuildRequest[]> {
    return this.store.list({
      orgId: principal.orgId ?? null,
      ...(mineOnly ? { submittedBy: principal.userId } : {}),
    });
  }

  async get(id: string, principal: AuthPrincipal): Promise<BuildRequest> {
    const scope: TenantScope = tenantScope(principal.orgId ?? null);
    const request = await this.store.get(id);
    if (!request || !belongsToTenant(scope, request.orgId)) {
      throw new NotFoundException(`request ${id} not found`); // cross-tenant → invisible
    }
    return request;
  }
}
