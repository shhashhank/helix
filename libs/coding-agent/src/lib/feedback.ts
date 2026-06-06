/**
 * Error feedback for the fix loop (HELIX-107): turn a failed {@link ChecksOutcome}
 * (HELIX-106) into concise, actionable feedback the agent can act on, then the
 * checks are re-run (the loop + its budget is HELIX-108).
 *
 * Compiler/linter output is parsed into structured {@link Diagnostic}s — `tsc`
 * and ESLint stylish formats are recognised, with a raw fallback when nothing
 * parses — and rendered into a bounded prompt (capped so a wall of errors can't
 * blow the context). Deterministic; the LLM that consumes the prompt is injected
 * by the caller.
 */
import { ChecksOutcome } from './checks';

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  file?: string;
  line?: number;
  column?: number;
  /** e.g. `TS2304` or an ESLint rule id. */
  code?: string;
  severity: Severity;
  message: string;
}

// e.g. `src/app.ts(12,5): error TS2304: Cannot find name 'foo'.`
const TS_DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;

/** Parse `tsc`-style diagnostics from compiler output. */
export function parseTypeScriptDiagnostics(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const raw of output.split('\n')) {
    const m = TS_DIAGNOSTIC.exec(raw.trimEnd());
    if (m) {
      diagnostics.push({
        file: m[1],
        line: Number(m[2]),
        column: Number(m[3]),
        severity: m[4] as Severity,
        code: m[5],
        message: m[6],
      });
    }
  }
  return diagnostics;
}

// ESLint "stylish": a file path line, then indented `  12:5  error  message  rule`.
const ESLINT_PATH = /^(?!\s)(\S.*\.[a-zA-Z]+)$/;
const ESLINT_LINE = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}([@\w./-]+))?\s*$/;

/** Parse ESLint stylish-format diagnostics. */
export function parseEslintDiagnostics(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let file: string | undefined;
  for (const raw of output.split('\n')) {
    const lineMatch = ESLINT_LINE.exec(raw);
    if (lineMatch) {
      diagnostics.push({
        file,
        line: Number(lineMatch[1]),
        column: Number(lineMatch[2]),
        severity: lineMatch[3] as Severity,
        message: lineMatch[4].trim(),
        code: lineMatch[5],
      });
      continue;
    }
    const pathMatch = ESLINT_PATH.exec(raw.trimEnd());
    if (pathMatch) file = pathMatch[1];
  }
  return diagnostics;
}

export interface CheckFeedback {
  name: string;
  exitCode: number | null;
  timedOut: boolean;
  diagnostics: Diagnostic[];
  /** Raw (truncated) output, included when no diagnostics parsed. */
  raw?: string;
}

export interface FixFeedback {
  /** True when the checks passed — no feedback needed. */
  ok: boolean;
  /** Feedback per failed check. */
  checks: CheckFeedback[];
  /** All parsed diagnostics, flattened. */
  diagnostics: Diagnostic[];
  /** True if some diagnostics were omitted from the prompt for length. */
  truncated: boolean;
  /** The instruction block to re-prompt the agent with (empty when ok). */
  prompt: string;
}

export interface FixFeedbackOptions {
  /** Max diagnostics to render in the prompt (default 50). */
  maxDiagnostics?: number;
  /** Max chars of raw output when nothing parsed (default 4000). */
  maxRawChars?: number;
}

/** Build re-prompt feedback from a checks outcome. */
export function buildFixFeedback(
  outcome: ChecksOutcome,
  options: FixFeedbackOptions = {},
): FixFeedback {
  const maxDiagnostics = options.maxDiagnostics ?? 50;
  const maxRawChars = options.maxRawChars ?? 4000;

  if (outcome.ok) {
    return { ok: true, checks: [], diagnostics: [], truncated: false, prompt: '' };
  }

  const checks: CheckFeedback[] = outcome.results
    .filter((r) => !r.ok)
    .map((r) => {
      const combined = [r.stdout, r.stderr].filter(Boolean).join('\n');
      const diagnostics = [
        ...parseTypeScriptDiagnostics(combined),
        ...parseEslintDiagnostics(combined),
      ];
      const feedback: CheckFeedback = {
        name: r.name,
        exitCode: r.exitCode,
        timedOut: r.timedOut,
        diagnostics,
      };
      if (diagnostics.length === 0) feedback.raw = truncate(combined, maxRawChars);
      return feedback;
    });

  const allDiagnostics = checks.flatMap((c) => c.diagnostics);
  const truncated = allDiagnostics.length > maxDiagnostics;

  return {
    ok: false,
    checks,
    diagnostics: allDiagnostics.slice(0, maxDiagnostics),
    truncated,
    prompt: renderPrompt(checks, maxDiagnostics, allDiagnostics.length),
  };
}

function renderPrompt(checks: CheckFeedback[], maxDiagnostics: number, total: number): string {
  let budget = maxDiagnostics;
  const sections = checks.map((c) => {
    const status = c.timedOut ? 'timed out' : c.exitCode != null ? `exit ${c.exitCode}` : 'failed';
    const header = `## ${c.name} (${status})`;
    if (c.diagnostics.length === 0) {
      return `${header}\n${c.raw ? '```\n' + c.raw + '\n```' : '(no diagnostics parsed)'}`;
    }
    const show = c.diagnostics.slice(0, Math.max(0, budget));
    budget -= show.length;
    return `${header}\n${show.map(formatDiagnostic).join('\n')}`;
  });
  if (total > maxDiagnostics) {
    sections.push(`… and ${total - maxDiagnostics} more diagnostic(s) omitted.`);
  }
  return [
    'The build/lint checks failed. Fix the problems below, then they will be re-run.',
    '',
    ...sections,
  ].join('\n');
}

function formatDiagnostic(d: Diagnostic): string {
  const loc = [d.file, d.line, d.column].filter((p) => p !== undefined).join(':');
  const code = d.code ? ` (${d.code})` : '';
  return `- [${d.severity}] ${loc ? `${loc} — ` : ''}${d.message}${code}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (truncated)`;
}
