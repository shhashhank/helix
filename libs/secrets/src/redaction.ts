/**
 * Secret redaction for telemetry (HELIX-92).
 *
 * Even with `SecretValue` guarding deliberate handling, a credential can still
 * end up as a *raw string* inside a trace attribute, an error message, or a tool
 * result. This `Redactor` scrubs that material before it reaches any telemetry
 * surface, two ways:
 *
 *   1. **Value-based** — exact secret strings registered with the redactor (e.g.
 *      the credentials resolved at a tool's execution boundary) are replaced
 *      wherever they appear.
 *   2. **Pattern-based** — well-known credential shapes (PEM keys, JWTs, GitHub /
 *      OpenAI / AWS tokens, `Bearer …`, `secret=…`) are matched and masked even
 *      when we don't hold the literal value.
 *
 * `redactDeep` walks objects/arrays so a whole trace span can be scrubbed in one
 * call. Built on plain string ops + regex — no dependency, runs in offline CI.
 */
import { SecretValue } from './secret-value';

/** The mask substituted for any detected secret. */
export const REDACTED = '[REDACTED]';

/** A named credential shape and what to replace a match with (`$1` etc. allowed). */
export interface RedactionRule {
  pattern: RegExp;
  replacement: string;
}

/** Conservative, low-false-positive rules for common credential shapes. */
export const DEFAULT_REDACTION_RULES: RedactionRule[] = [
  // PEM private key blocks (the GitHub App key, TLS keys, …).
  {
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replacement: REDACTED,
  },
  // JSON Web Tokens (three base64url segments, header starts `eyJ`).
  { pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: REDACTED },
  // GitHub tokens — classic (ghp_/gho_/…) and fine-grained (github_pat_).
  { pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, replacement: REDACTED },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, replacement: REDACTED },
  // OpenAI / Anthropic style keys (sk-…, sk-ant-…).
  { pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g, replacement: REDACTED },
  // AWS access key id.
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: REDACTED },
  // `Bearer <token>` — keep the scheme, mask the token.
  { pattern: /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, replacement: `$1${REDACTED}` },
  // `secret = …`, `api_key: "…"`, `token=…` — keep the label, mask the value.
  // (`Authorization` headers are handled by the `Bearer` rule above.)
  {
    pattern:
      /\b(password|passwd|secret|api[_-]?key|access[_-]?token|token)("?\s*[:=]\s*"?)([^\s"',}]+)/gi,
    replacement: `$1$2${REDACTED}`,
  },
];

export interface RedactorOptions {
  /** Exact secret values to always scrub (e.g. resolved credentials). */
  values?: string[];
  /** Override the default credential rules. */
  rules?: RedactionRule[];
  /** Registered values shorter than this are ignored, to avoid over-redaction (default 8). */
  minValueLength?: number;
}

export class Redactor {
  private readonly values = new Set<string>();
  private readonly rules: RedactionRule[];
  private readonly minValueLength: number;

  constructor(options: RedactorOptions = {}) {
    this.rules = options.rules ?? DEFAULT_REDACTION_RULES;
    this.minValueLength = options.minValueLength ?? 8;
    for (const v of options.values ?? []) this.registerSecret(v);
  }

  /** Register an exact secret value to scrub everywhere it appears. */
  registerSecret(value: string): void {
    if (value && value.length >= this.minValueLength) this.values.add(value);
  }

  /** Scrub a single string: known values first (literal), then credential patterns. */
  redact(text: string): string {
    let out = text;
    for (const value of this.values) out = out.split(value).join(REDACTED);
    for (const { pattern, replacement } of this.rules) {
      out = out.replace(ensureGlobal(pattern), replacement);
    }
    return out;
  }

  /** Recursively scrub strings in an object/array; `SecretValue` becomes the mask. */
  redactDeep<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
    if (typeof value === 'string') return this.redact(value) as unknown as T;
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof SecretValue) return REDACTED as unknown as T;
    if (Array.isArray(value)) return value.map((v) => this.redactDeep(v, seen)) as unknown as T;
    if (seen.has(value)) return value; // guard against cycles
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = this.redactDeep(v, seen);
    return out as T;
  }
}

/** A ready-to-use redactor with the default credential rules. */
export function createDefaultRedactor(values: string[] = []): Redactor {
  return new Redactor({ values });
}

function ensureGlobal(pattern: RegExp): RegExp {
  return pattern.flags.includes('g') ? pattern : new RegExp(pattern.source, pattern.flags + 'g');
}
