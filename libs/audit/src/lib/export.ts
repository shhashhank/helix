/**
 * Audit export formatters (HELIX-136): render a list of {@link AuditEvent}s for
 * download — newline-delimited JSON (one event per line, lossless incl. the hash
 * chain) or CSV (flat, spreadsheet-friendly). Pure + deterministic.
 */
import { AuditEvent } from './audit';

/** Newline-delimited JSON — one event per line (round-trips exactly). */
export function toNdjson(events: AuditEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

const CSV_COLUMNS = [
  'sequence',
  'id',
  'occurredAt',
  'type',
  'subjectType',
  'subjectId',
  'actor',
  'prevHash',
  'hash',
  'data',
] as const;

function csvCell(value: unknown): string {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a fixed header row; `data` is JSON-encoded into a single cell. */
export function toCsv(events: AuditEvent[]): string {
  const rows = events.map((event) =>
    [
      event.sequence,
      event.id,
      event.occurredAt,
      event.type,
      event.subject.type,
      event.subject.id,
      event.actor,
      event.prevHash,
      event.hash,
      JSON.stringify(event.data ?? {}),
    ]
      .map(csvCell)
      .join(','),
  );
  return [CSV_COLUMNS.join(','), ...rows].join('\n');
}
