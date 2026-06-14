/**
 * Testing agent tools as agent-loop executors (HELIX-163).
 *
 * Fills the executor's `toolsFor('testing', ws)` seam with two tools bound to the run's
 * sandbox:
 *  - `run_command` — run an arbitrary command (build / lint / inspect) via the
 *    {@link CommandRunner}, returning exit code + (truncated) output.
 *  - `run_tests` — detect the framework, run the project's tests ({@link runTests}),
 *    then parse the output into a structured {@link TestReport} — the run's **test
 *    artifact** — returned as a markdown summary ({@link formatTestReport}).
 *
 * Both come back as `isError` results on failure (non-zero exit / failing tests / a
 * timeout / bad input) so the agent reads the message and self-corrects instead of the
 * loop throwing. The `CommandRunner` never rejects (spawn errors surface as
 * `exitCode: null`), so neither tool throws into the loop.
 *
 * This is the **testing** half of the sandbox-backed tools; the worker looks up the run's
 * Sandbox and calls this to fill `toolsFor('testing', ws)` (HELIX-165).
 */
import { readFile } from 'node:fs/promises';
import type { ToolCall, ToolExecutor, ToolResult } from '@helix/agent';
import type { LlmToolDef } from '@helix/llm';
import { type CommandRunner, LocalCommandRunner, type Sandbox } from '@helix/sandbox';
import { z } from 'zod';
import { type SourceFile, TEST_FRAMEWORKS, type TestFramework } from './test-generation';
import { type TestCommand, detectFramework, runTests } from './test-runner';
import { buildTestReport, formatTestReport } from './report';

export const TESTING_TOOL_NAMES = {
  runCommand: 'run_command',
  runTests: 'run_tests',
} as const;

const runCommandSchema = z.object({
  command: z.string().min(1).describe('Executable to run (no shell; put arguments in "args").'),
  args: z.array(z.string()).optional().describe('Arguments passed to the command.'),
  cwd: z.string().optional().describe('Working dir relative to the workspace root.'),
  timeoutMs: z.number().int().positive().optional().describe('Wall-clock timeout in ms (killed on overrun).'),
});
const runTestsSchema = z.object({
  framework: z.enum(TEST_FRAMEWORKS).optional().describe('Test framework; auto-detected from the workspace if omitted.'),
  command: z.string().optional().describe('Explicit test executable (overrides the framework default).'),
  args: z.array(z.string()).optional().describe('Arguments for an explicit test command.'),
  packageManager: z.enum(['pnpm', 'npm', 'yarn']).optional().describe('Package manager for the default test script.'),
  cwd: z.string().optional().describe('Working dir relative to the workspace root.'),
  timeoutMs: z.number().int().positive().optional().describe('Wall-clock timeout in ms.'),
});

const json = (schema: z.ZodType): Record<string, unknown> => z.toJSONSchema(schema) as Record<string, unknown>;

/** The testing tools, ready to advertise on the agent spec. */
export const TESTING_TOOLS: LlmToolDef[] = [
  {
    name: TESTING_TOOL_NAMES.runCommand,
    description: 'Run a command in the workspace (build, lint, etc.) and capture its exit code + output.',
    inputSchema: json(runCommandSchema),
  },
  {
    name: TESTING_TOOL_NAMES.runTests,
    description: "Run the project's tests in the workspace and return a structured pass/fail + coverage report.",
    inputSchema: json(runTestsSchema),
  },
];

/** Project files inspected to auto-detect the test framework. */
const DETECT_FILES = ['package.json', 'pyproject.toml', 'requirements.txt', 'setup.cfg', 'conftest.py'];
/** Cap on per-stream output echoed back to the model, to protect the context window. */
const MAX_OUTPUT = 4000;

const tail = (s: string, max = MAX_OUTPUT): string =>
  s.length <= max ? s : `…(${s.length - max} chars truncated)…\n${s.slice(-max)}`;

/** Best-effort framework detection from the sandbox's project files. */
async function detectFrameworkFromSandbox(sandbox: Sandbox): Promise<TestFramework | undefined> {
  const files: SourceFile[] = [];
  for (const path of DETECT_FILES) {
    try {
      files.push({ path, content: await readFile(sandbox.resolve(path), 'utf8') });
    } catch {
      // missing / unreadable — skip
    }
  }
  return detectFramework(files);
}

export interface TestingToolsOptions {
  /** Command runner (default: a {@link LocalCommandRunner} rooted at the sandbox). */
  runner?: CommandRunner;
  /** Default wall-clock timeout applied when a call omits one (ms). */
  defaultTimeoutMs?: number;
}

/**
 * Build the testing agent's tools as a name→executor map bound to `sandbox`, ready to
 * drop into the agent loop's `executors`. Keys match {@link TESTING_TOOLS} names
 * (`run_command` / `run_tests`).
 */
export function testingTools(sandbox: Sandbox, options: TestingToolsOptions = {}): Record<string, ToolExecutor> {
  const runner = options.runner ?? new LocalCommandRunner(sandbox);
  const { defaultTimeoutMs } = options;

  const runCommand: ToolExecutor = async (call: ToolCall): Promise<ToolResult> => {
    const parsed = runCommandSchema.safeParse(call.input);
    if (!parsed.success) return { content: `invalid run_command input: ${parsed.error.message}`, isError: true };
    const { command, args, cwd, timeoutMs } = parsed.data;

    const exec = await runner.run(command, { args, cwd, timeoutMs: timeoutMs ?? defaultTimeoutMs });
    const ok = exec.exitCode === 0 && !exec.timedOut;
    const header = `$ ${exec.command}\nexit ${exec.exitCode ?? 'null'}${exec.timedOut ? ' (timed out)' : ''} in ${exec.durationMs}ms`;
    const body = [
      exec.stdout && `stdout:\n${tail(exec.stdout)}`,
      exec.stderr && `stderr:\n${tail(exec.stderr)}`,
    ]
      .filter(Boolean)
      .join('\n');
    return { content: body ? `${header}\n${body}` : header, isError: !ok };
  };

  const runTestsTool: ToolExecutor = async (call: ToolCall): Promise<ToolResult> => {
    const parsed = runTestsSchema.safeParse(call.input);
    if (!parsed.success) return { content: `invalid run_tests input: ${parsed.error.message}`, isError: true };
    const input = parsed.data;

    const framework = input.framework ?? (await detectFrameworkFromSandbox(sandbox)) ?? 'jest';
    const command: TestCommand | undefined = input.command ? { command: input.command, args: input.args } : undefined;
    const run = await runTests(runner, {
      command,
      framework,
      packageManager: input.packageManager,
      cwd: input.cwd,
      timeoutMs: input.timeoutMs ?? defaultTimeoutMs,
    });
    const report = buildTestReport(run, framework);
    return { content: formatTestReport(report), isError: !report.passed };
  };

  return {
    [TESTING_TOOL_NAMES.runCommand]: runCommand,
    [TESTING_TOOL_NAMES.runTests]: runTestsTool,
  };
}
