/**
 * Coding agent tools as agent-loop executors (HELIX-162).
 *
 * The executor's workspace seam hands a role its tools as a name→{@link ToolExecutor}
 * map (`@helix/executor`'s `WorkspaceTools.toolsFor`). This adapts the file-edit tools
 * ({@link FILE_EDIT_TOOLS} + {@link createFileEditToolHandler}, HELIX-103) into that
 * shape, bound to a {@link Sandbox}: each executor forwards the model's tool call to the
 * handler, whose results already carry `isError` for expected failures (missing file,
 * a path that escapes the root, bad input) — so nothing throws back into the agent loop.
 *
 * This is the **coding** half of the sandbox-backed tools; the worker looks up the run's
 * Sandbox and calls this to fill `toolsFor('coding', ws)` (HELIX-165). The matching tool
 * *definitions* are re-exported as {@link codingToolDefs} so the agent spec can advertise
 * exactly the tools these executors implement.
 */
import type { ToolCall, ToolExecutor, ToolResult } from '@helix/agent';
import type { LlmToolDef } from '@helix/llm';
import type { Sandbox } from '@helix/sandbox';
import { FILE_EDIT_TOOLS, createFileEditToolHandler } from './file-edit-tools';

/** The tool definitions the {@link codingFileEditTools} executors implement (read / write / patch). */
export const codingToolDefs: LlmToolDef[] = FILE_EDIT_TOOLS;

/**
 * Build the coding agent's file-edit tools as a name→executor map bound to `sandbox`,
 * ready to drop into the agent loop's `executors`. Keys match {@link codingToolDefs}
 * names (`read_file` / `write_file` / `patch_file`).
 */
export function codingFileEditTools(sandbox: Sandbox): Record<string, ToolExecutor> {
  const handle = createFileEditToolHandler(sandbox);
  const executors: Record<string, ToolExecutor> = {};
  for (const tool of FILE_EDIT_TOOLS) {
    executors[tool.name] = (call: ToolCall): Promise<ToolResult> => handle(call.name, call.input);
  }
  return executors;
}
