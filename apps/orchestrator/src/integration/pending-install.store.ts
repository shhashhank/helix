/**
 * Short-lived `state` → scope bindings for the in-flight install (HELIX-148). When
 * a connect starts we mint an unguessable `state`; the callback must present it,
 * and it's single-use — this is the CSRF/identity guard that stops an installation
 * from being attached to the wrong tenant. In-memory is fine (the binding only
 * needs to outlive the redirect); a durable store can drop in later.
 */
export interface PendingInstall {
  /** Vault scope (org/user) that began the connect. */
  scope: string;
  createdAt: number;
}

export interface PendingInstallStore {
  add(state: string, scope: string): void;
  /** Return and remove the binding for `state` (single-use), or undefined. */
  take(state: string): PendingInstall | undefined;
}

export class InMemoryPendingInstallStore implements PendingInstallStore {
  private readonly byState = new Map<string, PendingInstall>();

  add(state: string, scope: string): void {
    this.byState.set(state, { scope, createdAt: Date.now() });
  }

  take(state: string): PendingInstall | undefined {
    const pending = this.byState.get(state);
    if (pending) this.byState.delete(state);
    return pending;
  }
}
