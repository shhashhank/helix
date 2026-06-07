/**
 * Recipient directory (HELIX-133): resolve *who* to notify for a role into concrete
 * channel addresses (an email, a Slack id, an in-app user id). Kept generic — a role
 * maps to zero or more {@link Recipient}s — with an in-memory implementation; a real
 * org directory can drop in behind the same seam later.
 */
import { Recipient } from './notification';

export interface RecipientDirectory {
  /** The recipients to notify for an approver role (empty if none configured). */
  forRole(role: string): Promise<Recipient[]>;
}

/** In-memory `role → recipients` map. */
export class InMemoryRecipientDirectory implements RecipientDirectory {
  constructor(private readonly map: Record<string, Recipient[]> = {}) {}

  async forRole(role: string): Promise<Recipient[]> {
    return this.map[role] ?? [];
  }
}

/** Union the recipients for a set of roles, de-duplicated by channel+address. */
export async function recipientsForRoles(
  directory: RecipientDirectory,
  roles: string[],
): Promise<Recipient[]> {
  const out: Recipient[] = [];
  const seen = new Set<string>();
  for (const role of roles) {
    for (const recipient of await directory.forRole(role)) {
      const key = `${recipient.channel}:${recipient.address}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(recipient);
      }
    }
  }
  return out;
}
