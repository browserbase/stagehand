import {
  FACADE_AGENT_INSTRUCTIONS,
  FACADE_TOOLS,
} from "@browserbasehq/stagehand-integrations/facade";
import { createOpencodeClient, createOpencodeServer, type Config } from "@opencode-ai/sdk/v2";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGEHAND_TOOL_NAMES = FACADE_TOOLS.map((tool) => `stagehand_${tool.name}`);

export function buildAllowlistedEnv(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (/^(STAGEHAND_|BROWSERBASE_)/u.test(key) && value) env[key] = value;
  }
  return env;
}

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
  const data = readRecord(result)?.data;
  const parts = readRecord(data)?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => readRecord(part))
    .filter((part): part is Record<string, unknown> => part?.type === "text")
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

export function resolveInstruction(args: string[]): string {
  return (args[0] === "--" ? args.slice(1) : args).join(" ").trim();
}

type ApiResult = { data?: unknown; error?: unknown };

export type OpenCodeRuntime = {
  client: {
    session: {
      create(parameters?: unknown, options?: unknown): Promise<ApiResult>;
      prompt(parameters: unknown, options?: unknown): Promise<ApiResult>;
      delete(parameters: unknown, options?: unknown): Promise<ApiResult>;
    };
  };
  close(): void;
};

export type StartOpenCodeRuntime = (options: {
  config: Config;
  directory: string;
  configRoot: string;
  signal: AbortSignal;
}) => Promise<OpenCodeRuntime>;

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
  let runtime: OpenCodeRuntime | undefined;
  let sessionId: string | undefined;

  try {
    const config = buildOpenCodeConfig(facadeServerPath, env);
    runtime = await (options.startRuntime ?? startOpenCodeRuntime)({
      config,
      directory: join(runtimeDirectory, "workspace"),
      configRoot: join(runtimeDirectory, "config"),
      signal: abortController.signal,
    });
    const created = await runtime.client.session.create(
      { title: "Stagehand browser task" },
      { throwOnError: true, signal: abortController.signal },
    );
    assertNoApiError(created, "session creation");
    sessionId = readString(readRecord(created.data)?.id);
    if (!sessionId) throw new Error("OpenCode session creation returned no session ID.");

    const prompted = await runtime.client.session.prompt(
      {
        sessionID: sessionId,
        system: FACADE_AGENT_INSTRUCTIONS,
        tools: Object.fromEntries(STAGEHAND_TOOL_NAMES.map((name) => [name, true])),
        parts: [{ type: "text", text: instruction }],
      },
      { throwOnError: true, signal: abortController.signal },
    );
    assertNoApiError(prompted, "prompt");
    const text = extractAssistantText(prompted);
    if (!text) throw new Error("OpenCode returned no assistant text.");
    return text;
  } finally {
    if (runtime && sessionId) {
      await runtime.client.session
        .delete(
          { sessionID: sessionId },
          { throwOnError: false, signal: AbortSignal.timeout(5_000) },
        )
        .catch(() => undefined);
    }
    runtime?.close();
    removeSignalHandlers();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
}

export async function startOpenCodeRuntime(options: {
  config: Config;
  directory: string;
  configRoot: string;
  signal: AbortSignal;
}): Promise<OpenCodeRuntime> {
  await Promise.all([
    mkdir(options.directory, { recursive: true }),
    mkdir(join(options.configRoot, "xdg"), { recursive: true }),
    mkdir(join(options.configRoot, "extensions"), { recursive: true }),
  ]);
  const emptyConfigPath = join(options.configRoot, "opencode.json");
  await writeFile(emptyConfigPath, "{}\n", { mode: 0o600 });

  const server = await withTemporaryEnvironment(
    {
      XDG_CONFIG_HOME: join(options.configRoot, "xdg"),
      OPENCODE_CONFIG: emptyConfigPath,
      OPENCODE_CONFIG_DIR: join(options.configRoot, "extensions"),
    },
    () =>
      createOpencodeServer({
        hostname: "127.0.0.1",
        port: 0,
        timeout: 30_000,
        signal: options.signal,
        config: options.config,
      }),
  );
  const client = createOpencodeClient({
    baseUrl: server.url,
    directory: options.directory,
  });
  return {
    client: client as unknown as OpenCodeRuntime["client"],
    close: () => server.close(),
  };
}

export async function withTemporaryEnvironment<T>(
  overrides: Record<string, string>,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
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

function assertNoApiError(result: ApiResult, operation: string): void {
  if (result.error !== undefined) {
    throw new Error(`OpenCode ${operation} failed.`);
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
