import { createHash } from "node:crypto";
import { Stagehand, type StagehandClientInitParams } from "@browserbasehq/stagehand";
import { z } from "zod/v4";
import { createCodeFacades, type CodeFacades, type CodePageFacade } from "./facades.js";
import type { ChildRequest, ChildResponse } from "./runtime-protocol.js";
import type {
  CodeLogEntry,
  CodePageState,
  RuntimeRunResult,
  RuntimeStatus,
  StagehandCodeRuntimeConfig,
} from "./types.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;

let config: StagehandCodeRuntimeConfig | undefined;
let codeSessionId: string | undefined;
let stagehand: Stagehand | undefined;
let facades: CodeFacades | undefined;
let closed = false;
let queue = Promise.resolve();

process.on("message", (message: unknown) => {
  if (!isChildRequest(message)) return;
  queue = queue.then(() => handle(message));
});

process.once("SIGTERM", () => void shutdown(0));
process.once("SIGINT", () => void shutdown(0));
process.once("disconnect", () => void shutdown(0));

async function handle(request: ChildRequest): Promise<void> {
  try {
    switch (request.type) {
      case "configure": {
        if (config) throw new Error("Stagehand code runtime is already configured.");
        config = request.config;
        codeSessionId = request.codeSessionId;
        send({ id: request.id, ok: true });
        return;
      }
      case "run": {
        requireConfigured();
        const result = await runSnippet(request.code, request.timeoutMs);
        send({ id: request.id, ok: true, result });
        return;
      }
      case "status": {
        requireConfigured();
        send({ id: request.id, ok: true, result: await status() });
        return;
      }
      case "reset": {
        requireConfigured();
        await closeStagehand();
        send({ id: request.id, ok: true, result: { reset: true } });
        return;
      }
      case "close": {
        closed = true;
        await closeStagehand();
        send({ id: request.id, ok: true, result: { closed: true } });
        setImmediate(() => process.exit(0));
        return;
      }
    }
  } catch (error) {
    const normalized = normalizeError(error);
    send({
      id: request.id,
      ok: false,
      error: normalized,
      page: await readPageState().catch(() => undefined),
    });
    if (normalized.kind === "timeout") {
      closed = true;
      void closeStagehand()
        .catch(() => undefined)
        .finally(() => process.exit(1));
      setTimeout(() => process.exit(1), 2_000).unref();
    }
  }
}

async function ensureStagehand(): Promise<{
  stagehand: Stagehand;
  facades: CodeFacades;
}> {
  requireConfigured();
  if (stagehand && facades) return { stagehand, facades };
  const apiKey = config!.browserbaseApiKey;
  if (!apiKey) {
    throw new Error("BROWSERBASE_API_KEY is required before the first code_execute run.");
  }

  const initParams: StagehandClientInitParams = {
    apiKey,
    browser: {
      type: "browserbase",
      userMetadata: {
        integration: "stagehand-codemode-mcp",
        codeSessionHash: createHash("sha256").update(codeSessionId!).digest("hex").slice(0, 16),
      },
    },
    logging: { level: "off" },
    ...(config!.model ? { model: config!.model as StagehandClientInitParams["model"] } : {}),
  };
  const next = new Stagehand(initParams);
  await next.init();
  stagehand = next;
  facades = createCodeFacades(next, next.context);
  return { stagehand: next, facades };
}

async function runSnippet(code: string, timeoutMs: number): Promise<RuntimeRunResult> {
  if (closed) throw new Error("Stagehand code runtime is closed.");
  const runtime = await ensureStagehand();
  const rawPage =
    (await runtime.stagehand.context.activePage()) ??
    (await runtime.stagehand.context.pages())[0] ??
    (await runtime.stagehand.context.newPage());
  const page = runtime.facades.wrapPage(rawPage);
  const logs: CodeLogEntry[] = [];
  const codeConsole = Object.freeze({
    log: (...values: unknown[]) => logs.push({ level: "log", text: formatLog(values) }),
    warn: (...values: unknown[]) => logs.push({ level: "warn", text: formatLog(values) }),
    error: (...values: unknown[]) => logs.push({ level: "error", text: formatLog(values) }),
  });
  const fn = new AsyncFunction("page", "context", "stagehand", "z", "console", code);
  let timeout: NodeJS.Timeout | undefined;
  try {
    const value = await Promise.race([
      fn(page, runtime.facades.context, runtime.facades.stagehand, z, codeConsole),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(`Code execution exceeded ${timeoutMs}ms.`);
          error.name = "CodeExecutionTimeoutError";
          reject(error);
        }, timeoutMs);
      }),
    ]);
    return {
      value: jsonSafe(value),
      logs,
      page: await readRequiredPageState(page),
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function status(): Promise<RuntimeStatus> {
  if (!stagehand) return { state: "idle" };
  return {
    state: "ready",
    page: await readPageState(),
  };
}

async function readPageState(): Promise<CodePageState | undefined> {
  if (!stagehand || !facades) return undefined;
  const rawPage = (await stagehand.context.activePage()) ?? (await stagehand.context.pages())[0];
  if (!rawPage) return undefined;
  return readRequiredPageState(facades.wrapPage(rawPage));
}

async function readRequiredPageState(page: CodePageFacade): Promise<CodePageState> {
  const [url, title] = await Promise.all([page.url(), page.title()]);
  return { url, title };
}

async function closeStagehand(): Promise<void> {
  const current = stagehand;
  stagehand = undefined;
  facades = undefined;
  await current?.close();
}

async function shutdown(exitCode: number): Promise<void> {
  closed = true;
  await closeStagehand().catch(() => undefined);
  process.exit(exitCode);
}

function requireConfigured(): void {
  if (!config || !codeSessionId) throw new Error("Stagehand code runtime is not configured.");
}

function send(response: ChildResponse): void {
  if (process.connected) process.send?.(response);
}

function normalizeError(error: unknown): Extract<ChildResponse, { ok: false }>["error"] {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const timeout = normalized.name === "CodeExecutionTimeoutError";
  return {
    name: normalized.name,
    message: normalized.message,
    kind: timeout ? "timeout" : closed ? "closed" : "runtime",
    retryable: false,
    mayHaveSideEffects: timeout,
    ...(normalized.stack ? { stack: normalized.stack } : {}),
  };
}

function formatLog(values: unknown[]): string {
  return values
    .map((value) => {
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(jsonSafe(value));
      } catch {
        return String(value);
      }
    })
    .join(" ");
}

function jsonSafe(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_key, nested) => {
      if (typeof nested === "bigint") return nested.toString();
      if (nested instanceof Uint8Array) {
        return {
          type: "bytes",
          encoding: "base64",
          data: Buffer.from(nested).toString("base64"),
        };
      }
      return nested;
    }),
  );
}

function isChildRequest(value: unknown): value is ChildRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "type" in value &&
    typeof value.type === "string"
  );
}
