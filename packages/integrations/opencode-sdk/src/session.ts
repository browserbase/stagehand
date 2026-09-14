import { createOpencodeClient, createOpencodeServer, type Config } from "@opencode-ai/sdk/v2";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  HarnessAdapterError,
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";

export type OpenCodePart = Record<string, unknown>;

export interface OpenCodeMessage {
  info: Record<string, unknown>;
  parts: OpenCodePart[];
}

export interface OpenCodeTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface OpenCodeSessionResult {
  messages: OpenCodeMessage[];
  finalMessage: string;
  status: "completed" | "sdk_error";
  stopReason?: string;
  tokenUsage: OpenCodeTokenUsage;
  costUsd?: number;
  iterationError?: unknown;
}

type ApiResult = { data?: unknown; error?: unknown };

export type OpenCodeRuntime = {
  client: {
    session: {
      create(parameters?: unknown, options?: unknown): Promise<ApiResult>;
      prompt(parameters: unknown, options?: unknown): Promise<ApiResult>;
      abort(parameters: unknown, options?: unknown): Promise<ApiResult>;
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

export interface OpenCodeSessionConfig {
  config: Config;
  directory: string;
  configRoot: string;
  systemPrompt?: string;
  tools?: Record<string, boolean>;
}

export function normalizeOpenCodeModel(
  model: string,
): { providerID: string; modelID: string } | undefined {
  if (model === "opencode/auto" || model === "auto") return undefined;
  const separator = model.indexOf("/");
  if (separator < 1 || separator === model.length - 1) {
    throw new HarnessAdapterError(
      `OpenCode model "${sanitizeErrorMessage(model)}" must use provider/model format.`,
    );
  }
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) };
}

export function extractOpenCodeAssistantText(message: unknown): string {
  const parts = readRecord(message)?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map(readRecord)
    .filter((part): part is Record<string, unknown> => part?.type === "text")
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

export function buildOpenCodeTranscript(messages: OpenCodeMessage[]): string {
  return messages
    .flatMap((message) =>
      message.parts.map((part) => {
        if (part.type === "reasoning" && typeof part.text === "string") {
          return `[reasoning] ${part.text}`;
        }
        if (part.type === "text" && typeof part.text === "string") return part.text;
        if (part.type === "tool") {
          const state = readRecord(part.state);
          return `[tool ${String(part.tool ?? "unknown")}] ${safeStringify(state)}`;
        }
        return "";
      }),
    )
    .filter(Boolean)
    .join("\n");
}

export async function runOpenCodeSession(input: {
  prompt: string;
  model: string;
  logger: HarnessLogger;
  signal?: AbortSignal;
  session: OpenCodeSessionConfig;
  startRuntime?: StartOpenCodeRuntime;
  onToolResult?: (toolName: string, part: OpenCodePart) => void | Promise<void>;
}): Promise<OpenCodeSessionResult> {
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) controller.abort(input.signal.reason);
  else input.signal?.addEventListener("abort", forwardAbort, { once: true });

  let runtime: OpenCodeRuntime | undefined;
  let sessionId: string | undefined;
  let messages: OpenCodeMessage[] = [];
  let iterationError: unknown;
  let stopReason: string | undefined;
  try {
    runtime = await (input.startRuntime ?? startOpenCodeRuntime)({
      config: input.session.config,
      directory: input.session.directory,
      configRoot: input.session.configRoot,
      signal: controller.signal,
    });
    const created = await runtime.client.session.create(
      { title: "Stagehand browser benchmark" },
      { throwOnError: true, signal: controller.signal },
    );
    assertNoApiError(created, "session creation");
    sessionId = readString(readRecord(created.data)?.id);
    if (!sessionId) throw new Error("OpenCode session creation returned no session ID.");

    const model = normalizeOpenCodeModel(input.model);
    const prompted = await runtime.client.session.prompt(
      {
        sessionID: sessionId,
        ...(model && { model }),
        ...(input.session.systemPrompt && { system: input.session.systemPrompt }),
        ...(input.session.tools && { tools: input.session.tools }),
        parts: [{ type: "text", text: input.prompt }],
      },
      { throwOnError: true, signal: controller.signal },
    );
    assertNoApiError(prompted, "prompt");
    const message = normalizeMessage(prompted.data);
    if (!message) throw new Error("OpenCode prompt returned no assistant message.");
    messages = [message];
    for (const part of message.parts) {
      if (part.type !== "tool") continue;
      const status = readRecord(part.state)?.status;
      if (status === "completed" || status === "error") {
        await input.onToolResult?.(readString(part.tool) ?? "tool", part);
      }
    }
  } catch (error) {
    iterationError = error;
    stopReason = sanitizeErrorMessage(
      stringifyError(input.signal?.aborted ? input.signal.reason : error),
    );
    input.logger.warn({
      category: "opencode",
      message: `OpenCode stopped before a normal result: ${stopReason}`,
      level: 0,
    });
  } finally {
    input.signal?.removeEventListener("abort", forwardAbort);
    if (runtime && sessionId && controller.signal.aborted) {
      await runtime.client.session
        .abort(
          { sessionID: sessionId },
          { throwOnError: false, signal: AbortSignal.timeout(5_000) },
        )
        .catch(() => undefined);
    }
    if (runtime && sessionId) {
      await runtime.client.session
        .delete(
          { sessionID: sessionId },
          { throwOnError: false, signal: AbortSignal.timeout(5_000) },
        )
        .catch(() => undefined);
    }
    runtime?.close();
  }

  const finalMessage = extractOpenCodeAssistantText(messages.at(-1));
  const info = messages.at(-1)?.info;
  const usage = normalizeUsage(readRecord(info?.tokens));
  const assistantError = readRecord(info?.error);
  if (!stopReason && assistantError) {
    stopReason = sanitizeErrorMessage(
      readString(assistantError.data && readRecord(assistantError.data)?.message) ??
        readString(assistantError.message) ??
        "OpenCode assistant failed.",
    );
  }
  return {
    messages,
    finalMessage,
    status: iterationError || assistantError ? "sdk_error" : "completed",
    ...(stopReason && { stopReason }),
    tokenUsage: usage,
    ...(typeof info?.cost === "number" && Number.isFinite(info.cost) && { costUsd: info.cost }),
    ...(iterationError !== undefined && { iterationError }),
  };
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
  const client = createOpencodeClient({ baseUrl: server.url, directory: options.directory });
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

function normalizeMessage(value: unknown): OpenCodeMessage | undefined {
  const record = readRecord(value);
  const info = readRecord(record?.info);
  const parts = record?.parts;
  if (!info || !Array.isArray(parts)) return undefined;
  return { info, parts: parts.map(readRecord).filter(isDefined) };
}

function normalizeUsage(tokens: Record<string, unknown> | undefined): OpenCodeTokenUsage {
  const cache = readRecord(tokens?.cache);
  const inputTokens = finite(tokens?.input);
  const outputTokens = finite(tokens?.output);
  const reasoningOutputTokens = finite(tokens?.reasoning);
  const cachedInputTokens = finite(cache?.read);
  const cacheCreationInputTokens = finite(cache?.write);
  return {
    inputTokens,
    outputTokens,
    reasoningOutputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    totalTokens: finite(tokens?.total) || inputTokens + outputTokens + reasoningOutputTokens,
  };
}

function assertNoApiError(result: ApiResult, operation: string): void {
  if (result.error !== undefined) throw new Error(`OpenCode ${operation} failed.`);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function stringifyError(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return safeStringify(value);
}
