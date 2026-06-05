/**
 * A wrapper that keeps secret material from leaking by accident.
 *
 * `toString`, `toJSON`, and Node's `util.inspect` (what `console.log` and most
 * loggers use under the hood) all return a redacted marker instead of the
 * material — so a `SecretValue` nested in a logged object, an error message, or a
 * `JSON.stringify` shows `[REDACTED]`, never the secret. The plaintext lives in a
 * true `#private` field (not enumerated by `util.inspect`), and the *only* way to
 * read it is the explicit {@link SecretValue.expose} call. This is the
 * value-level guard the vault hands out; trace/log scrubbing is HELIX-92.
 */
import { inspect } from 'node:util';

/** The placeholder shown wherever a secret would otherwise be rendered. */
export const REDACTED_MARKER = '[REDACTED]';

export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** The single, explicit door to the underlying secret. */
  expose(): string {
    return this.#value;
  }

  /** Length of the secret, for sanity checks, without revealing it. */
  get length(): number {
    return this.#value.length;
  }

  toString(): string {
    return REDACTED_MARKER;
  }

  toJSON(): string {
    return REDACTED_MARKER;
  }

  [inspect.custom](): string {
    return `SecretValue(${REDACTED_MARKER})`;
  }
}
