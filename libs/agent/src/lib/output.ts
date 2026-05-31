import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

/** Result of coercing + validating an agent's final text against a schema. */
export interface OutputValidationResult<T = unknown> {
  valid: boolean;
  /** Parsed value (present whenever JSON could be extracted, even if invalid). */
  data?: T;
  /** Human-readable problems: a parse error, or per-field schema errors. */
  errors?: string[];
  /** The original final text. */
  raw: string;
}

/**
 * Pull a JSON value out of model output that may be wrapped in ``` fences or
 * surrounding prose. Tries, in order: a fenced block, the whole string, then the
 * first `{…}`/`[…]` span. Throws if nothing parses.
 */
export function extractJson(text: string): unknown {
  const candidates: string[] = [];
  const trimmed = text.trim();

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) candidates.push(fence[1].trim());
  candidates.push(trimmed);

  const objStart = trimmed.search(/[[{]/);
  if (objStart !== -1) {
    const lastClose = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (lastClose > objStart) candidates.push(trimmed.slice(objStart, lastClose + 1));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  throw new SyntaxError('no parseable JSON found in output');
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`.trim());
}

/**
 * Coerce the text to JSON and validate it against a JSON Schema. Never throws —
 * returns a result with `valid`, the parsed `data` (when extractable), and
 * `errors`. Use this on an agent's final output when the agent definition
 * declares an `outputSchema`.
 */
export function validateOutput<T = unknown>(
  text: string,
  schema: Record<string, unknown>,
): OutputValidationResult<T> {
  let data: unknown;
  try {
    data = extractJson(text);
  } catch (err) {
    return { valid: false, errors: [(err as Error).message], raw: text };
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  if (validate(data)) {
    return { valid: true, data: data as T, raw: text };
  }
  return { valid: false, data: data as T, errors: formatErrors(validate.errors), raw: text };
}
