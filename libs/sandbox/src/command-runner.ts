/**
 * Command execution in the sandbox (HELIX-106). The {@link CommandRunner} seam
 * runs a command in the workspace and captures its exit code + output;
 * {@link LocalCommandRunner} spawns a real child process via `child_process`,
 * rooted at the sandbox (cwd through the path guard) and killed if it exceeds a
 * wall-clock timeout. Real and offline-testable — running inside a container is
 * the deferred backend, but the local spawn is genuine.
 */
import { spawn } from 'node:child_process';
import type { Sandbox } from './sandbox';

export interface ExecResult {
  /** The command line, for reference/logging. */
  command: string;
  /** Process exit code, or `null` if it was killed (e.g. timed out). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** True if the process was killed for exceeding the timeout. */
  timedOut: boolean;
  durationMs: number;
}

export interface RunOptions {
  args?: string[];
  /** Working dir, relative to the sandbox root (default: the root). */
  cwd?: string;
  /** Extra env vars, merged over the parent environment. */
  env?: Record<string, string>;
  /** Wall-clock timeout in ms; the process is killed (SIGKILL) on overrun. */
  timeoutMs?: number;
}

export interface CommandRunner {
  run(command: string, options?: RunOptions): Promise<ExecResult>;
}

/** Runs commands as real child processes rooted at the sandbox workspace. */
export class LocalCommandRunner implements CommandRunner {
  constructor(private readonly sandbox: Sandbox) {}

  run(command: string, options: RunOptions = {}): Promise<ExecResult> {
    const cwd = this.sandbox.resolve(options.cwd ?? '.'); // throws on escape
    const args = options.args ?? [];
    const line = [command, ...args].join(' ');
    const start = Date.now();

    return new Promise<ExecResult>((resolve) => {
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...options.env },
        shell: false,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer =
        options.timeoutMs && options.timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              child.kill('SIGKILL');
            }, options.timeoutMs)
          : undefined;

      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));

      const finish = (exitCode: number | null, extraStderr = ''): void => {
        if (timer) clearTimeout(timer);
        resolve({
          command: line,
          exitCode,
          stdout,
          stderr: stderr + extraStderr,
          timedOut,
          durationMs: Date.now() - start,
        });
      };

      // Failed to even start the process (e.g. command not found).
      child.on('error', (err) => finish(null, `${err.message}\n`));
      child.on('close', (code) => finish(timedOut ? null : code, ''));
    });
  }
}
