/**
 * Secret scan (HELIX-114): a fast, deterministic gitleaks-style pass over the
 * diff's **added lines**, flagging committed credentials as blocker findings.
 *
 * The patterns mirror the credential shapes `@helix/secrets` redacts (PEM keys,
 * JWTs, GitHub / OpenAI / AWS tokens, generic `secret=…`). It complements the
 * LLM security review with a reliable detector — no model needed — and never
 * echoes the secret value in the finding. Only *added* lines are scanned, so a
 * pre-existing secret isn't blamed on this change.
 */
import { DiffFile } from './review-context';
import { Finding } from './findings';

export interface SecretPattern {
  name: string;
  pattern: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'PEM private key', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { name: 'JSON Web Token', pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { name: 'GitHub token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/ },
  { name: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'OpenAI/Anthropic API key', pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/ },
  { name: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: 'hard-coded secret assignment',
    pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|token)["']?\s*[:=]\s*["']?[^\s"',}]{6,}/i,
  },
];

const SECRET_SUGGESTION =
  'Remove the secret from the code and load it from the secrets vault (@helix/secrets) at runtime.';

/** Scan a diff's added lines for committed secrets; returns blocker findings. */
export function scanDiffForSecrets(files: DiffFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (file.status === 'deleted') continue;
    for (const line of addedLines(file.diff)) {
      const match = SECRET_PATTERNS.find((p) => p.pattern.test(line));
      if (match) {
        findings.push({
          aspect: 'security',
          severity: 'blocker',
          file: file.path,
          message: `Possible committed secret (${match.name}) on an added line.`,
          suggestion: SECRET_SUGGESTION,
        });
      }
    }
  }
  return findings;
}

/** The added (`+`) lines of a line-prefixed diff, with the prefix stripped. */
function addedLines(diff: string): string[] {
  return diff
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));
}
