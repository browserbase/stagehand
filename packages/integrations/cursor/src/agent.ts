import {
  runCursorSdkAgentSession,
  type CursorSdkAgentFactory,
} from "@browserbasehq/stagehand-integrations-cursor-sdk";
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

export function buildCursorPrompt(instruction: string): string {
  return `${FACADE_AGENT_INSTRUCTIONS}\n\nTask:\n${instruction}`;
}

export function resolveInstruction(args: string[]): string {
  return (args[0] === "--" ? args.slice(1) : args).join(" ").trim();
}

export class CursorInterruptionError extends Error {
  readonly signal: NodeJS.Signals | undefined;

  constructor(signal?: NodeJS.Signals) {
    super("Cursor run interrupted.");
    this.name = "CursorInterruptionError";
    this.signal = signal;
  }
}

export type RunCursorOptions = {
  env?: NodeJS.ProcessEnv;
  facadeServerPath?: string;
  makeWorkspaceDirectory?: () => Promise<string>;
  createAgent?: CursorSdkAgentFactory;
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
  const controller = new AbortController();
  let interruptedBy: NodeJS.Signals | undefined;
  const removeSignalHandlers = forwardTerminationSignals((signal) => {
    interruptedBy ??= signal;
    controller.abort(new CursorInterruptionError(interruptedBy));
  });

  try {
    const result = await runCursorSdkAgentSession({
      prompt: buildCursorPrompt(instruction),
      model: env.CURSOR_STAGEHAND_MODEL?.trim() || DEFAULT_CURSOR_MODEL,
      apiKey: env.CURSOR_API_KEY?.trim() ?? "",
      cwd: workspaceDirectory,
      mcpServers: {
        stagehand: {
          type: "stdio",
          command: process.execPath,
          args: [facadeServerPath],
          env: buildAllowlistedEnv(env),
        },
      },
      // The example prints one final result; the reusable SDK owns event logging,
      // cancellation, disposal, settings isolation and its disposable local store.
      logger: { log: () => {}, warn: () => {}, error: () => {} },
      signal: controller.signal,
      ...(options.createAgent && { createAgent: options.createAgent }),
    });
    if (interruptedBy) throw new CursorInterruptionError(interruptedBy);
    if (result.raw.status === "cancelled") throw new CursorInterruptionError();
    if (result.status !== "completed") {
      throw new Error(`Cursor run failed${result.stopReason ? `: ${result.stopReason}` : "."}`);
    }
    const text = result.resultText.trim();
    if (!text) throw new Error("Cursor returned no assistant text.");
    return text;
  } finally {
    removeSignalHandlers();
    await rm(workspaceDirectory, { recursive: true, force: true });
  }
}

async function createWorkspaceDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "stagehand-cursor-"));
}

function forwardTerminationSignals(onSignal: (signal: NodeJS.Signals) => void): () => void {
  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  return () => {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  };
}

async function main(): Promise<void> {
  const instruction = resolveInstruction(process.argv.slice(2));
  if (!instruction) throw new Error('Usage: pnpm start "your instruction"');
  // oxlint-disable-next-line no-console -- CLI example prints the agent result.
  console.log(await runCursor(instruction));
}

if (import.meta.main) {
  main().catch(handleFailure);
}

export function handleFailure(error: unknown): void {
  if (error instanceof CursorInterruptionError && error.signal) {
    process.kill(process.pid, error.signal);
    return;
  }
  // oxlint-disable-next-line no-console -- CLI example reports failures to stderr.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
