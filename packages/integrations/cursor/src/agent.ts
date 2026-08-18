import { Agent, JsonlLocalAgentStore, type AgentOptions, type RunResult } from "@cursor/sdk";
import { FACADE_AGENT_INSTRUCTIONS } from "@browserbasehq/stagehand-integrations/facade";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CURSOR_MODEL = "composer-2.5";

export function buildAllowlistedEnv(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (/^(STAGEHAND_|BROWSERBASE_)/u.test(key) && value) env[key] = value;
  }
  return env;
}

export function buildCursorAgentOptions(
  workspaceDirectory: string,
  facadeServerPath: string,
  source: NodeJS.ProcessEnv = process.env,
): AgentOptions {
  const apiKey = source.CURSOR_API_KEY?.trim();
  const model = source.CURSOR_STAGEHAND_MODEL?.trim() || DEFAULT_CURSOR_MODEL;
  return {
    ...(apiKey ? { apiKey } : {}),
    model: { id: model },
    name: "Stagehand browser task",
    local: {
      cwd: workspaceDirectory,
      // Do not inherit project/user MCP servers, hooks, skills, or other
      // ambient Cursor configuration into this isolated example run.
      settingSources: [],
      // Keep Cursor's durable local-agent records inside the disposable
      // workspace instead of writing them to the user's default SDK store.
      store: new JsonlLocalAgentStore(join(workspaceDirectory, ".cursor-sdk-store")),
    },
    // Cursor treats "mcp" as the capability group for all MCP tools. Because
    // the isolated agent has exactly one inline server, this leaves only the
    // Stagehand facade's run, snapshot, and screenshot tools available.
    tools: ["mcp"],
    mcpServers: {
      stagehand: {
        type: "stdio",
        command: process.execPath,
        args: [facadeServerPath],
        env: buildAllowlistedEnv(source),
      },
    },
  };
}

export function buildCursorPrompt(instruction: string): string {
  return `${FACADE_AGENT_INSTRUCTIONS}\n\nTask:\n${instruction}`;
}

export function resolveInstruction(args: string[]): string {
  return (args[0] === "--" ? args.slice(1) : args).join(" ").trim();
}

type CursorRunResult = Pick<RunResult, "status" | "result" | "error">;

export type CursorRuntimeRun = {
  wait(): Promise<CursorRunResult>;
  cancel(): Promise<void>;
};

export type CursorRuntimeAgent = {
  send(message: string): Promise<CursorRuntimeRun>;
  [Symbol.asyncDispose](): Promise<void>;
};

export type RunCursorOptions = {
  env?: NodeJS.ProcessEnv;
  facadeServerPath?: string;
  makeWorkspaceDirectory?: () => Promise<string>;
  createAgent?: (options: AgentOptions) => Promise<CursorRuntimeAgent>;
};

export async function runCursor(
  instruction: string,
  options: RunCursorOptions = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const facadeServerPath =
    options.facadeServerPath ??
    fileURLToPath(import.meta.resolve("@browserbasehq/stagehand-integrations/facade/stdio-server"));
  const workspaceDirectory = await (options.makeWorkspaceDirectory ?? createWorkspaceDirectory)();
  let agent: CursorRuntimeAgent | undefined;
  let activeRun: CursorRuntimeRun | undefined;
  let interrupted = false;

  const removeSignalHandlers = forwardTerminationSignals(() => {
    interrupted = true;
    if (activeRun) void activeRun.cancel().catch(() => undefined);
  });

  try {
    const createAgent = options.createAgent ?? ((agentOptions) => Agent.create(agentOptions));
    agent = await createAgent(buildCursorAgentOptions(workspaceDirectory, facadeServerPath, env));
    if (interrupted) throw new Error("Cursor run interrupted.");
    activeRun = await agent.send(buildCursorPrompt(instruction));

    const result = await activeRun.wait();
    if (interrupted) throw new Error("Cursor run interrupted.");
    if (result.status === "cancelled") throw new Error("Cursor run interrupted.");
    if (result.status === "error") {
      const detail = result.error?.message?.trim();
      throw new Error(detail ? `Cursor run failed: ${detail}` : "Cursor run failed.");
    }

    const text = result.result?.trim();
    if (!text) throw new Error("Cursor returned no assistant text.");
    return text;
  } finally {
    removeSignalHandlers();
    try {
      if (agent) await agent[Symbol.asyncDispose]();
    } finally {
      await rm(workspaceDirectory, { recursive: true, force: true });
    }
  }
}

async function createWorkspaceDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "stagehand-cursor-"));
}

function forwardTerminationSignals(onSignal: () => void): () => void {
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return () => {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  };
}

async function main(): Promise<void> {
  const instruction = resolveInstruction(process.argv.slice(2));
  if (!instruction) throw new Error('Usage: pnpm start "your instruction"');
  // oxlint-disable-next-line no-console -- CLI example prints the agent result.
  console.log(await runCursor(instruction));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    // oxlint-disable-next-line no-console -- CLI example reports failures to stderr.
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
