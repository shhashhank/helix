/**
 * Approval inbox (HELIX-178): the pending sign-offs an approver acts on. Each card shows
 * the gated action, who asked + why, quorum progress and SLA, and lets you cast an
 * approve / reject decision (as one of the still-awaiting roles, with an optional comment).
 * Deciding resumes the gated run once quorum resolves; the inbox refreshes after each vote.
 */
import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import type { InboxItem } from '../../api/types';

function formatSla(item: InboxItem): string {
  if (item.slaRemainingSeconds === undefined) return 'no SLA';
  const mins = Math.round(item.slaRemainingSeconds / 60);
  return mins >= 0 ? `${mins} min left` : `${Math.abs(mins)} min overdue`;
}

function ApprovalCard({
  item,
  approver,
  busy,
  onDecide,
}: {
  item: InboxItem;
  approver: string;
  busy: boolean;
  onDecide: (role: string, vote: 'approve' | 'reject', comment: string) => void;
}): ReactElement {
  const roles = item.awaitingRoles.length ? item.awaitingRoles : item.approverRoles;
  const [role, setRole] = useState(roles[0] ?? '');
  const [comment, setComment] = useState('');

  return (
    <article className="helix-card helix-approval">
      <h3>{item.action}</h3>
      <p className="helix-muted">
        {item.requestedBy ? `Requested by ${item.requestedBy}` : 'Requested'}
        {item.reason ? ` — ${item.reason}` : ''}
      </p>
      <p>
        <strong>
          {item.approvals}/{item.required} approvals
        </strong>{' '}
        ({item.remaining} more needed{item.rejections ? `, ${item.rejections} rejection(s)` : ''}) · {formatSla(item)}
      </p>
      <label>
        Acting as role
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label>
        Comment (optional)
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Looks good" />
      </label>
      <div className="helix-approval-actions">
        <button type="button" disabled={busy || !role} onClick={() => onDecide(role, 'approve', comment)}>
          Approve
        </button>
        <button type="button" disabled={busy || !role} onClick={() => onDecide(role, 'reject', comment)}>
          Reject
        </button>
      </div>
      <p className="helix-muted helix-small">as {approver}</p>
    </article>
  );
}

export function ApprovalInbox(): ReactElement {
  const { api, principal } = useAuth();
  const approver = principal?.email ?? principal?.userId ?? 'unknown';
  const [items, setItems] = useState<InboxItem[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | undefined>();

  const load = useCallback(async (): Promise<void> => {
    try {
      setItems(await api.get<InboxItem[]>('/api/approvals/inbox'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the inbox');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (item: InboxItem, role: string, vote: 'approve' | 'reject', comment: string): Promise<void> => {
    setBusyId(item.id);
    setError(undefined);
    try {
      await api.post(`/api/approvals/${item.id}/decisions`, { approver, role, vote, comment: comment || undefined });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record the decision');
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <section className="helix-inbox">
      <h1>Approval inbox</h1>
      {error && <p role="alert" className="helix-error">{error}</p>}
      {items.length === 0 ? (
        <p className="helix-muted">Nothing awaiting approval. 🎉</p>
      ) : (
        items.map((item) => (
          <ApprovalCard
            key={item.id}
            item={item}
            approver={approver}
            busy={busyId === item.id}
            onDecide={(role, vote, comment) => void decide(item, role, vote, comment)}
          />
        ))
      )}
    </section>
  );
}

export default ApprovalInbox;
