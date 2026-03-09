import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import process from "node:process";
import type {
  ExecCommandArgs,
  ExecCommandResult,
  WriteStdinArgs,
  WriteStdinResult,
} from "./protocol.js";

type RunningProcessSession = {
  id: number;
  command: string;
  proc: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

const DEFAULT_YIELD_MS = 1_000;
const APPROX_CHARS_PER_TOKEN = 4;

function truncateOutput(
  value: string,
  maxOutputTokens: number | undefined,
): { text: string; truncated: boolean } {
  if (!maxOutputTokens) {
    return { text: value, truncated: false };
  }

  const maxChars = maxOutputTokens * APPROX_CHARS_PER_TOKEN;
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }

  const suffix = "\n...[truncated]";
  return {
    text: `${value.slice(-Math.max(0, maxChars - suffix.length))}${suffix}`,
    truncated: true,
  };
}

function buildShellInvocation(args: ExecCommandArgs): {
  shellPath: string;
  shellArgs: string[];
} {
  const shellPath = args.shell ?? process.env.SHELL ?? "/bin/bash";
  const login = args.login ?? true;
  const shellFlag = login ? "-lc" : "-c";
  return { shellPath, shellArgs: [shellFlag, args.cmd] };
}

async function waitForOutput(
  session: RunningProcessSession,
  yieldTimeMs: number,
): Promise<void> {
  if (session.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, yieldTimeMs);
    const handleExit = () => {
      clearTimeout(timer);
      resolve();
    };
    session.proc.once("exit", handleExit);
  });
}

export class ProcessSessionManager {
  private readonly sessions = new Map<number, RunningProcessSession>();
  private nextId = 1;

  async exec(args: ExecCommandArgs): Promise<ExecCommandResult> {
    const { shellPath, shellArgs } = buildShellInvocation(args);
    const sessionId = this.nextId++;
    const proc = spawn(shellPath, shellArgs, {
      cwd: args.workdir ? path.resolve(args.workdir) : process.cwd(),
      env: process.env,
      stdio: "pipe",
    });

    const session: RunningProcessSession = {
      id: sessionId,
      command: args.cmd,
      proc,
      stdout: "",
      stderr: "",
      exitCode: null,
    };

    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      session.stdout += chunk;
    });
    proc.stderr.on("data", (chunk: string) => {
      session.stderr += chunk;
    });
    proc.on("exit", (code) => {
      session.exitCode = code ?? 0;
    });

    this.sessions.set(sessionId, session);
    await waitForOutput(session, args.yield_time_ms ?? DEFAULT_YIELD_MS);
    return this.snapshotSession(session, args.max_output_tokens);
  }

  async write(args: WriteStdinArgs): Promise<WriteStdinResult> {
    const session = this.sessions.get(args.session_id);
    if (!session) {
      return {
        session_id: args.session_id,
        stdout: "",
        stderr: `No running session ${args.session_id}`,
        exit_code: null,
        running: false,
      };
    }

    if (args.chars) {
      session.proc.stdin.write(args.chars);
    }

    await waitForOutput(session, args.yield_time_ms ?? DEFAULT_YIELD_MS);
    return this.snapshotSession(session, args.max_output_tokens);
  }

  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.exitCode === null) {
        session.proc.kill("SIGTERM");
      }
    }
    this.sessions.clear();
  }

  async execCommand(
    args: ExecCommandArgs,
    context?: { workspace?: string },
  ): Promise<ExecCommandResult> {
    return this.exec({
      ...args,
      workdir: args.workdir ?? context?.workspace,
    });
  }

  async writeStdin(args: WriteStdinArgs): Promise<WriteStdinResult> {
    return this.write(args);
  }

  private snapshotSession(
    session: RunningProcessSession,
    maxOutputTokens?: number,
  ): ExecCommandResult {
    const stdout = truncateOutput(session.stdout, maxOutputTokens);
    const stderr = truncateOutput(session.stderr, maxOutputTokens);
    const running = session.exitCode === null;

    // We intentionally keep stdin-pipe sessions instead of a true PTY. That is
    // sufficient for bash/file workflows now, while leaving space for a future
    // host-backed PTY adapter without changing the serialized tool contract.
    if (!running) {
      this.sessions.delete(session.id);
    }

    return {
      session_id: running ? session.id : undefined,
      stdout: stdout.text,
      stderr: stderr.text,
      exit_code: session.exitCode,
      running,
      truncated: stdout.truncated || stderr.truncated,
    };
  }
}
