/**
 * Append-only, hash-chained audit log (HELIX-135). Every event is linked to the one
 * before it by a SHA-256 hash (`hash = sha256(prevHash + canonical(event))`), so the
 * log is **tamper-evident**: altering, reordering, or dropping any past event breaks
 * the chain and {@link verifyChain} pinpoints where. The store only ever *appends* —
 * there is no update or delete — and returns frozen events.
 *
 * Generic by design (a `subject` is any `{ type, id }`), so approvals (HELIX-9) and
 * later epics can share it. The in-memory store here is the seam's first
 * implementation; a durable append-only store is deferred (see DEFERRED.md).
 */
import { createHash, randomUUID } from 'node:crypto';

/** The genesis link — the `prevHash` of the very first event. */
export const GENESIS_HASH = '0'.repeat(64);

/** A reference to the thing an event is about (e.g. `{ type: 'approval', id: 'appr-1' }`). */
export interface AuditSubject {
  type: string;
  id: string;
}

/** The content of an event, before it's chained into the log. */
export interface AuditEventDraft {
  id: string;
  type: string;
  occurredAt: string;
  subject: AuditSubject;
  /** Who/what caused it (user id, agent role, or `system`). */
  actor?: string;
  /** Immutable structured detail captured at the time. */
  data?: Record<string, unknown>;
}

/** A stored, chained event. */
export interface AuditEvent extends AuditEventDraft {
  /** 0-based position in the chain. */
  sequence: number;
  prevHash: string;
  /** `sha256(prevHash + canonical(draft))`. */
  hash: string;
}

export interface AuditEventInput {
  type: string;
  subject: AuditSubject;
  actor?: string;
  data?: Record<string, unknown>;
  /** Defaults to a random uuid. */
  id?: string;
  /** Defaults to now. */
  now?: Date;
}

/** Build an event draft (assigns an id + timestamp); the store chains it on append. */
export function auditEvent(input: AuditEventInput): AuditEventDraft {
  return {
    id: input.id ?? randomUUID(),
    type: input.type,
    occurredAt: (input.now ?? new Date()).toISOString(),
    subject: input.subject,
    actor: input.actor,
    data: input.data,
  };
}

/** Deterministic, key-sorted serialization so the hash is stable across runs. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
    .join(',')}}`;
}

/** The chain hash for a draft given its predecessor's hash. */
export function hashEvent(prevHash: string, draft: AuditEventDraft): string {
  const payload = canonicalize({
    prevHash,
    id: draft.id,
    type: draft.type,
    occurredAt: draft.occurredAt,
    subject: draft.subject,
    actor: draft.actor ?? null,
    data: draft.data ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export interface AuditVerification {
  ok: boolean;
  /** Index of the first event whose link is broken, if any. */
  brokenAt?: number;
  reason?: string;
}

/** Re-derive the chain and confirm every event's sequence, prevHash, and hash hold. */
export function verifyChain(events: AuditEvent[]): AuditVerification {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.sequence !== i) return { ok: false, brokenAt: i, reason: 'sequence mismatch' };
    if (event.prevHash !== prevHash) return { ok: false, brokenAt: i, reason: 'prevHash mismatch' };
    if (event.hash !== hashEvent(prevHash, event)) {
      return { ok: false, brokenAt: i, reason: 'hash mismatch' };
    }
    prevHash = event.hash;
  }
  return { ok: true };
}

export interface AuditQuery {
  subjectType?: string;
  subjectId?: string;
  type?: string;
  /** Return only the most recent N (chronological order preserved). */
  limit?: number;
}

/** Append-only, hash-chained audit log. No update or delete. */
export interface AuditLog {
  append(draft: AuditEventDraft): Promise<AuditEvent>;
  list(query?: AuditQuery): Promise<AuditEvent[]>;
  verify(): Promise<AuditVerification>;
}

/** Process-local append-only log. Durable store deferred (see DEFERRED.md). */
export class InMemoryAuditLog implements AuditLog {
  private readonly events: AuditEvent[] = [];
  private lastHash = GENESIS_HASH;

  async append(draft: AuditEventDraft): Promise<AuditEvent> {
    const prevHash = this.lastHash;
    const event: AuditEvent = Object.freeze({
      ...draft,
      sequence: this.events.length,
      prevHash,
      hash: hashEvent(prevHash, draft),
    });
    this.events.push(event);
    this.lastHash = event.hash;
    return event;
  }

  async list(query: AuditQuery = {}): Promise<AuditEvent[]> {
    let out = this.events.filter(
      (e) =>
        (query.subjectType === undefined || e.subject.type === query.subjectType) &&
        (query.subjectId === undefined || e.subject.id === query.subjectId) &&
        (query.type === undefined || e.type === query.type),
    );
    if (query.limit !== undefined && query.limit >= 0) out = out.slice(-query.limit);
    return out;
  }

  async verify(): Promise<AuditVerification> {
    return verifyChain(this.events);
  }
}
