import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { AuthPrincipal } from '@helix/auth';
import { type TenantScope, belongsToTenant, tenantScope } from '@helix/tenancy';
import type { WorkflowDefinition, WorkflowProgress } from '@helix/workflow';
import type { RunStatus } from '@helix/workflow/temporal-client';
import { WorkflowRunService } from '../workflow-run/workflow-run.service';
import { RunArtifacts, extractArtifacts } from './artifacts';
import { BuildRequest } from './request.model';
import { REQUEST_STORE, RequestStore } from './request.store';
import { type DeliveryRepo, requestToWorkflow } from './request.workflow';

export interface SubmitBuildRequest {
  title: string;
  prompt: string;
  /** Optional explicit workflow DSL; defaults to the standard delivery pipeline. */
  workflow?: WorkflowDefinition;
  /** Optional target repo — when set, the run opens a PR with its changes (HELIX-186). */
  repo?: DeliveryRepo;
}

/** A request joined with its run's current status — one row of the run dashboard (HELIX-146). */
export interface DashboardItem {
  request: BuildRequest;
  run: RunStatus;
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
    const def = input.workflow ?? requestToWorkflow({ id, repo: input.repo });
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

  /** Current run status for a request (tenant-scoped) — the dashboard's per-run detail (HELIX-146). */
  async runStatus(id: string, principal: AuthPrincipal): Promise<RunStatus> {
    const request = await this.get(id, principal);
    return this.runs.get(request.workflowId);
  }

  /** The caller org's requests joined with each run's current status — the dashboard overview. */
  async overview(principal: AuthPrincipal, mineOnly = false): Promise<DashboardItem[]> {
    const requests = await this.list(principal, mineOnly);
    return Promise.all(requests.map(async (request) => ({ request, run: await this.runs.get(request.workflowId) })));
  }

  /** The PR/test/deploy artifacts a request's run has produced (tenant-scoped, HELIX-147). */
  async artifacts(id: string, principal: AuthPrincipal): Promise<RunArtifacts> {
    const request = await this.get(id, principal);
    return extractArtifacts(await this.runs.progress(request.workflowId));
  }

  /**
   * Live per-step progress for a request's run (HELIX-146) — the "SSE-driven" feed.
   * Confirms the request is in the caller's tenant first, then defers to the run's
   * progress stream; a cross-tenant id surfaces as an error on the stream.
   */
  streamProgress(id: string, principal: AuthPrincipal): Observable<WorkflowProgress> {
    return from(this.get(id, principal)).pipe(switchMap((request) => this.runs.streamProgress(request.workflowId)));
  }
}
