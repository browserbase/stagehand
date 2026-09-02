import {
  FACADE_AGENT_INSTRUCTIONS,
  FACADE_TOOLS,
} from "@browserbasehq/stagehand-integrations/facade";
import {
  buildAllowlistedEnv,
  sanitizeErrorMessage,
} from "@browserbasehq/stagehand-integrations/harness";
import {
  extractOpenCodeAssistantText,
  runOpenCodeSession,
  type OpenCodeRuntime,
  type StartOpenCodeRuntime,
} from "@browserbasehq/stagehand-integrations-opencode-sdk";
import type { Config } from "@opencode-ai/sdk/v2";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGEHAND_TOOL_NAMES = FACADE_TOOLS.map((tool) => `stagehand_${tool.name}`);

export function buildOpenCodeConfig(
  facadeServerPath: string,
  source: NodeJS.ProcessEnv = process.env,
): Config {
  const tools: Record<string, boolean> = { "*": false };
  const permission: Record<string, "allow" | "deny"> = { "*": "deny" };
  for (const toolName of STAGEHAND_TOOL_NAMES) {
    tools[toolName] = true;
    permission[toolName] = "allow";
  }
  return {
    share: "disabled",
    autoupdate: false,
    ...(source.OPENCODE_MODEL?.trim() ? { model: source.OPENCODE_MODEL.trim() } : {}),
    mcp: {
      stagehand: {
        type: "local",
        enabled: true,
        command: [process.execPath, facadeServerPath],
        environment: buildAllowlistedEnv(source),
      },
    },
    tools,
    permission,
  };
}

export function extractAssistantText(result: unknown): string {
  if (result && typeof result === "object" && "data" in result) {
    return extractOpenCodeAssistantText((result as { data?: unknown }).data);
  }
  return extractOpenCodeAssistantText(result);
}

export function resolveInstruction(args: string[]): string {
  return (args[0] === "--" ? args.slice(1) : args).join(" ").trim();
}

export type { OpenCodeRuntime };

export type RunOpenCodeOptions = {
  env?: NodeJS.ProcessEnv;
  facadeServerPath?: string;
  startRuntime?: StartOpenCodeRuntime;
  makeRuntimeDirectory?: () => Promise<string>;
};

export async function runOpenCode(
  instruction: string,
  options: RunOpenCodeOptions = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const facadeServerPath =
    options.facadeServerPath ??
    fileURLToPath(import.meta.resolve("@browserbasehq/stagehand-integrations/facade/stdio-server"));
  const runtimeDirectory = await (options.makeRuntimeDirectory ?? createRuntimeDirectory)();
  const abortController = new AbortController();
  const removeSignalHandlers = forwardTerminationSignals(abortController);
  try {
    const result = await runOpenCodeSession({
      prompt: instruction,
      model: env.OPENCODE_MODEL?.trim() || "opencode/auto",
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
      signal: abortController.signal,
      startRuntime: options.startRuntime,
      session: {
        config: buildOpenCodeConfig(facadeServerPath, env),
        directory: join(runtimeDirectory, "workspace"),
        configRoot: join(runtimeDirectory, "config"),
        systemPrompt: FACADE_AGENT_INSTRUCTIONS,
        tools: Object.fromEntries(STAGEHAND_TOOL_NAMES.map((name) => [name, true])),
      },
    });
    if (result.status !== "completed") {
      throw new Error(result.stopReason ?? "OpenCode did not complete the task.");
    }
    if (!result.finalMessage) throw new Error("OpenCode returned no assistant text.");
    return result.finalMessage;
  } finally {
    removeSignalHandlers();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
}

async function createRuntimeDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "stagehand-opencode-"));
}

function forwardTerminationSignals(controller: AbortController): () => void {
  const onSignal = () => controller.abort(new Error("OpenCode run interrupted."));
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
  console.log(await runOpenCode(instruction));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    // oxlint-disable-next-line no-console -- CLI example reports failures to stderr.
    console.error(sanitizeErrorMessage(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
