/** Shared MCP tool-result helpers for the GitHub tools. */

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

/** A successful text result. */
export const textResult = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });

/** An error result (`isError: true`) for an expected failure — surfaced to the caller, not thrown. */
export const errorResult = (what: string, err: unknown): ToolResult => ({
  content: [{ type: 'text', text: `error ${what}: ${err instanceof Error ? err.message : String(err)}` }],
  isError: true,
});
