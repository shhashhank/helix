/**
 * File edit tools (HELIX-103): the read / write / patch operations exposed as
 * LLM tools the coding agent can call during its loop. Each tool's input is a
 * Zod schema (reused as the JSON Schema given to the model), and the handler
 * validates the input, runs the operation against the bound {@link Sandbox}, and
 * returns a tool result. Expected failures (missing file, un-applicable patch,
 * a path that escapes the sandbox, bad input) come back as `isError` results so
 * the agent can read the message and self-correct.
 */
import type { LlmToolDef } from '@helix/llm';
import type { Sandbox } from '@helix/sandbox';
import { z } from 'zod';
import { patchFile, readFile, writeFile } from './file-edits';

export const FILE_EDIT_TOOL_NAMES = {
  read: 'read_file',
  write: 'write_file',
  patch: 'patch_file',
} as const;

const readSchema = z.object({
  path: z.string().min(1).describe('Workspace-relative file path.'),
});
const writeSchema = z.object({
  path: z.string().min(1).describe('Workspace-relative file path.'),
  content: z.string().describe('Full new file contents (creates or overwrites).'),
});
const patchSchema = z.object({
  path: z.string().min(1).describe('Workspace-relative file path.'),
  oldText: z.string().min(1).describe('Exact snippet to replace; must be present.'),
  newText: z.string().describe('Replacement text.'),
  replaceAll: z.boolean().optional().describe('Replace all occurrences (else the snippet must be unique).'),
});

const json = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema) as Record<string, unknown>;

/** The file-edit tools, ready to hand to the agent loop / LLM. */
export const FILE_EDIT_TOOLS: LlmToolDef[] = [
  {
    name: FILE_EDIT_TOOL_NAMES.read,
    description: 'Read a UTF-8 text file from the workspace.',
    inputSchema: json(readSchema),
  },
  {
    name: FILE_EDIT_TOOL_NAMES.write,
    description: 'Create or overwrite a UTF-8 text file in the workspace.',
    inputSchema: json(writeSchema),
  },
  {
    name: FILE_EDIT_TOOL_NAMES.patch,
    description: 'Replace an exact snippet (oldText) with newText in a workspace file.',
    inputSchema: json(patchSchema),
  },
];

export interface ToolResult {
  content: string;
  isError?: boolean;
}

/**
 * Build a dispatcher that runs the file-edit tools against `sandbox`. Returns a
 * function `(toolName, input) => ToolResult`; unknown tools and operation/validation
 * failures are returned as `isError` results rather than thrown.
 */
export function createFileEditToolHandler(
  sandbox: Sandbox,
): (toolName: string, input: unknown) => Promise<ToolResult> {
  return async (toolName, input) => {
    try {
      switch (toolName) {
        case FILE_EDIT_TOOL_NAMES.read: {
          const { path } = readSchema.parse(input);
          return { content: await readFile(sandbox, path) };
        }
        case FILE_EDIT_TOOL_NAMES.write: {
          const { path, content } = writeSchema.parse(input);
          await writeFile(sandbox, path, content);
          return { content: `wrote ${path}` };
        }
        case FILE_EDIT_TOOL_NAMES.patch: {
          const { path, oldText, newText, replaceAll } = patchSchema.parse(input);
          const { replacements } = await patchFile(sandbox, path, { oldText, newText, replaceAll });
          return { content: `patched ${path} (${replacements} replacement${replacements === 1 ? '' : 's'})` };
        }
        default:
          return { content: `unknown tool: ${toolName}`, isError: true };
      }
    } catch (err) {
      return { content: err instanceof Error ? err.message : String(err), isError: true };
    }
  };
}
