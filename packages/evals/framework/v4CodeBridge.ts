import fs from "node:fs";
import path from "node:path";
import {
  executeV4CodeSnippet,
  initializeV4CodeRuntime,
  type V4CodeRuntime,
} from "./v4CodeRuntime.js";
import {
  stringifyV4CodeConsoleValue,
  type V4CodeBridgeConsoleEvent,
  type V4CodeBridgeLifecycleEvent,
  type V4CodeBridgeRequest,
  type V4CodeBridgeResponse,
} from "./v4CodeController.js";
import type { V4CodeBrowserConfig } from "./v4CodeConfig.js";

let runtime: V4CodeRuntime | undefined;
let initPromise: Promise<V4CodeRuntime> | undefined;
let requestQueue = Promise.resolve();
let shuttingDown = false;
let shutdownPromise: Promise<void> | undefined;

if (!process.send) {
  throw new Error("V4 code bridge requires a Node IPC channel.");
}

process.on("message", (message: V4CodeBridgeRequest) => {
  requestQueue = requestQueue
    .then(() => handleRequest(message))
    .catch((error: unknown) => {
      sendResponse({
        id: message.id,
        ok: false,
        error: serializeError(error),
      });
    });
});

process.once("disconnect", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});

async function handleRequest(message: V4CodeBridgeRequest): Promise<void> {
  switch (message.type) {
    case "init": {
      if (runtime) throw new Error("V4 code bridge is already initialized.");
      if (initPromise) {
        throw new Error(
          "V4 code bridge initialization is already in progress.",
        );
      }
      const pendingRuntime = initializeV4CodeRuntime({
        sdkPath: message.sdkPath,
        browser: message.browser,
        mode: message.mode,
        ...(message.mode === "ai" && { model: message.model }),
        onBrowserbaseResources: (resources) =>
          sendLifecycleEvent({
            type: "browserbase_resources",
            resources,
          }),
      });
      initPromise = pendingRuntime;
      const initializedRuntime = await pendingRuntime;
      if (shuttingDown) {
        // shutdown() owns a runtime that settles after termination begins.
        return;
      }
      runtime = initializedRuntime;
      initPromise = undefined;
      sendResponse({
        id: message.id,
        ok: true,
        result: {
          browserPid: readBrowserPid(message.browser),
          ...(runtime.browserbaseResources && {
            resources: runtime.browserbaseResources,
          }),
        },
      });
      return;
    }
    case "execute": {
      if (!runtime) throw new Error("V4 code bridge is not initialized.");
      const result = await executeV4CodeSnippet({
        code: message.code,
        runtime,
        mode: runtime.mode,
        startUrl: message.startUrl,
        task: message.task,
        console: buildSnippetConsole(message.id),
      });
      sendResponse({
        id: message.id,
        ok: true,
        result: makeIpcSafeResult(result),
      });
      return;
    }
    case "close": {
      await closeRuntime();
      sendResponse({ id: message.id, ok: true }, () => {
        if (process.connected) process.disconnect();
      });
    }
  }
}

function buildSnippetConsole(
  requestId: number,
): Pick<Console, "log" | "warn" | "error"> {
  const write = (
    level: V4CodeBridgeConsoleEvent["level"],
    values: unknown[],
  ): void => {
    sendConsoleEvent({
      type: "console",
      requestId,
      level,
      message: values.map(stringifyV4CodeConsoleValue).join(" "),
    });
  };
  return {
    log: (...values) => write("log", values),
    warn: (...values) => write("warn", values),
    error: (...values) => write("error", values),
  };
}

function makeIpcSafeResult(value: unknown): unknown {
  if (value === undefined || typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : JSON.parse(serialized);
  } catch {
    return String(value);
  }
}

function readBrowserPid(browser: V4CodeBrowserConfig): number | undefined {
  const userDataDir =
    browser.type === "local" ? browser.userDataDir : undefined;
  if (!userDataDir) return undefined;
  const pidFile = path.join(userDataDir, "chrome.pid");
  if (!fs.existsSync(pidFile)) return undefined;
  const parsed = Number(fs.readFileSync(pidFile, "utf8").trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function shutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    try {
      const initializing = initPromise;
      if (initializing) {
        try {
          const initializedRuntime = await initializing;
          await initializedRuntime.close();
        } catch {
          // Runtime initialization owns cleanup for partial provisioning.
        }
      }
      await closeRuntime();
    } finally {
      initPromise = undefined;
      process.exitCode = 0;
      if (process.connected) process.disconnect();
    }
  })();
  return shutdownPromise;
}

async function closeRuntime(): Promise<void> {
  const activeRuntime = runtime;
  runtime = undefined;
  await activeRuntime?.close();
}

function sendResponse(
  response: V4CodeBridgeResponse,
  callback?: () => void,
): void {
  if (!process.send || !process.connected) return;
  process.send(response, callback);
}

function sendConsoleEvent(event: V4CodeBridgeConsoleEvent): void {
  if (!process.send || !process.connected) return;
  process.send(event);
}

function sendLifecycleEvent(event: V4CodeBridgeLifecycleEvent): Promise<void> {
  if (!process.send || !process.connected) {
    return Promise.reject(
      new Error("V4 code bridge resource lifecycle IPC channel is closed."),
    );
  }
  return new Promise((resolve, reject) => {
    process.send?.(event, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function serializeError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (!(error instanceof Error)) {
    return { name: "Error", message: String(error) };
  }
  return {
    name: error.name,
    message: error.message,
    ...(error.stack && { stack: error.stack }),
  };
}
