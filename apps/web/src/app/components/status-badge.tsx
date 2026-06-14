import { type ReactElement } from 'react';

const COLORS: Record<string, string> = {
  RUNNING: '#2563eb',
  COMPLETED: '#16a34a',
  FAILED: '#dc2626',
  running: '#2563eb',
  success: '#16a34a',
  failure: '#dc2626',
  skipped: '#9ca3af',
  pending: '#9ca3af',
};

/** A small coloured pill for a run / step status. */
export function StatusBadge({ status }: { status: string }): ReactElement {
  return (
    <span className="helix-badge" style={{ backgroundColor: COLORS[status] ?? '#6b7280' }}>
      {status}
    </span>
  );
}

export default StatusBadge;
