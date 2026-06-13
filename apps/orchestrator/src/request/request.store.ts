import type { OrgId } from '@helix/tenancy';
import type { BuildRequest } from './request.model';

/** DI token for the {@link RequestStore}. */
export const REQUEST_STORE = Symbol('REQUEST_STORE');

export interface ListRequestsFilter {
  /** Restrict to one org/tenant (always set in practice — row-level scoping). */
  orgId?: OrgId;
  /** Restrict to one submitter. */
  submittedBy?: string;
}

/**
 * Where build requests live. Mirrors the approval-store seam: the orchestrator is
 * otherwise stateless (durable state is the Temporal run), so this in-memory store
 * is fine for a single process and a durable (DB) store drops in later — see
 * DEFERRED.md.
 */
export interface RequestStore {
  put(request: BuildRequest): Promise<void>;
  get(id: string): Promise<BuildRequest | undefined>;
  list(filter?: ListRequestsFilter): Promise<BuildRequest[]>;
}

/** Process-local store, newest-first on list. Lost on restart (durable store deferred). */
export class InMemoryRequestStore implements RequestStore {
  private readonly byId = new Map<string, BuildRequest>();

  async put(request: BuildRequest): Promise<void> {
    this.byId.set(request.id, request);
  }

  async get(id: string): Promise<BuildRequest | undefined> {
    return this.byId.get(id);
  }

  async list(filter: ListRequestsFilter = {}): Promise<BuildRequest[]> {
    return [...this.byId.values()]
      .filter(
        (r) =>
          (filter.orgId === undefined || r.orgId === filter.orgId) &&
          (filter.submittedBy === undefined || r.submittedBy === filter.submittedBy),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
