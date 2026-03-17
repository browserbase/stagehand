import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import type {
  AgentSubagentConfig,
  BrowserId,
  ManagedAgentId,
} from "./protocol.js";

const execFileAsync = promisify(execFile);
function getBrowseCliInvocation(args: string[]): {
  command: string;
  args: string[];
} {
  return {
    command: "browse",
    args: ["--json", ...args],
  };
}

function toCliValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

export function buildBrowseCliShellPrefix(): string {
  return "browse --json";
}

function getBrowseBrowserSessionName(browserId: BrowserId): string {
  return `browser-${browserId}`;
}

export function buildBrowseBrowserSessionArgs(browserId: BrowserId): string[] {
  return ["--session", getBrowseBrowserSessionName(browserId)];
}

export function buildBrowseNamedSessionArgs(session: ManagedAgentId): string[] {
  return ["--session", session];
}

export function buildSubagentConfigFlags(
  config: Partial<AgentSubagentConfig> | undefined,
): string[] {
  if (!config) {
    return [];
  }

  const args: string[] = [];
  if (config.mode) {
    args.push("--mode", config.mode);
  }
  if (config.model) {
    args.push("--model", toCliValue(config.model));
  }
  if (config.executionModel) {
    args.push("--execution-model", toCliValue(config.executionModel));
  }
  if (config.systemPrompt) {
    args.push("--system-prompt", config.systemPrompt);
  }
  return args;
}

export async function runBrowseCli(args: string[]): Promise<unknown> {
  try {
    const invocation = getBrowseCliInvocation(args);
    const { stdout } = await execFileAsync(
      invocation.command,
      invocation.args,
      {
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    const text = stdout.trim();
    if (!text) {
      return null;
    }

    return JSON.parse(text);
  } catch (error) {
    const execError = error as {
      code?: string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (execError.code === "ENOENT") {
      throw new Error("browse CLI command not found on PATH");
    }
    const detail = execError.stderr?.trim() || execError.stdout?.trim();
    throw new Error(detail || execError.message || "browse CLI command failed");
  }
}

export function spawnBrowseCli(
  args: string[],
): ChildProcessWithoutNullStreams {
  const invocation = getBrowseCliInvocation(args);
  return spawn(invocation.command, invocation.args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
}
