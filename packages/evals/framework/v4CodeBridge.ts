import fs from "node:fs";
import path from "node:path";
import {
  executeV4DeterministicSnippet,
  initializeV4DeterministicRuntime,
  type V4DeterministicRuntime,
} from "./v4CodeRuntime.js";
import type {
  V4CodeBridgeConsoleEvent,
  V4CodeBridgeRequest,
  V4CodeBridgeResponse,
} from "./v4CodeController.js";

let runtime: V4DeterministicRuntime | undefined;
let requestQueue = Promise.resolve();
let shuttingDown = false;

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
      runtime = await initializeV4DeterministicRuntime({
        sdkPath: message.sdkPath,
        userDataDir: message.userDataDir,
      });
      sendResponse({
        id: message.id,
        ok: true,
        result: {
          browserPid: readBrowserPid(message.userDataDir),
        },
      });
      return;
    }
    case "execute": {
      if (!runtime) throw new Error("V4 code bridge is not initialized.");
      const result = await executeV4DeterministicSnippet({
        code: message.code,
        runtime,
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
      message: values.map(stringifyConsoleValue).join(" "),
    });
  };
  return {
    log: (...values) => write("log", values),
    warn: (...values) => write("warn", values),
    error: (...values) => write("error", values),
  };
}

function stringifyConsoleValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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

function readBrowserPid(userDataDir: string | undefined): number | undefined {
  if (!userDataDir) return undefined;
  const pidFile = path.join(userDataDir, "chrome.pid");
  if (!fs.existsSync(pidFile)) return undefined;
  const parsed = Number(fs.readFileSync(pidFile, "utf8").trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await closeRuntime();
  } finally {
    process.exitCode = 0;
    if (process.connected) process.disconnect();
  }
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
