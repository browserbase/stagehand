import {
  fork as nodeFork,
  spawnSync,
  type ChildProcess,
  type ForkOptions,
} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getRepoRootDir } from "../runtimePaths.js";
import { STAGEHAND_V4_SDK_PATH_ENV, resolveV4SdkPath } from "./v4CodeConfig.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_EXECUTE_TIMEOUT_MS = 60_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;
const CHILD_EXIT_GRACE_MS = 1_000;

export type V4CodeBridgeRequest =
  | { id: number; type: "init"; sdkPath: string; userDataDir?: string }
  | {
      id: number;
      type: "execute";
      code: string;
      startUrl: string;
      task: Record<string, unknown>;
    }
  | { id: number; type: "close" };

export type V4CodeBridgeResponse =
  | { id: number; ok: true; result?: unknown }
  | {
      id: number;
      ok: false;
      error: { name: string; message: string; stack?: string };
    };

export type V4CodeBridgeConsoleEvent = {
  type: "console";
  requestId: number;
  level: "log" | "warn" | "error";
  message: string;
};

type V4CodeBridgeRequestPayload = V4CodeBridgeRequest extends infer Request
  ? Request extends V4CodeBridgeRequest
    ? Omit<Request, "id">
    : never
  : never;

export interface V4CodeController {
  execute(input: {
    code: string;
    startUrl: string;
    task: Record<string, unknown>;
  }): Promise<unknown>;
  close(): Promise<void>;
}

export type V4CodeBridgeFork = (
  modulePath: string,
  args: readonly string[],
  options: ForkOptions,
) => ChildProcess;

export interface StartV4CodeControllerInput {
  sdkPath?: string;
  bridgePath?: string;
  forkProcess?: V4CodeBridgeFork;
  inheritChildLogs?: boolean;
  workingDirectory?: string;
  onConsole?: (event: V4CodeBridgeConsoleEvent) => void;
  startupTimeoutMs?: number;
  executeTimeoutMs?: number;
  closeTimeoutMs?: number;
}

type PendingRequest = {
  requestType: V4CodeBridgeRequest["type"];
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export async function startV4CodeController(
  input: StartV4CodeControllerInput = {},
): Promise<V4CodeController> {
  const sdkPath = input.sdkPath ?? resolveV4SdkPath();
  const bridgePath = input.bridgePath ?? resolveV4CodeBridgePath();
  const forkProcess = input.forkProcess ?? nodeFork;
  const workingDirectory = input.workingDirectory
    ? requireDirectory(input.workingDirectory, "workingDirectory")
    : undefined;
  const browserUserDataDir = workingDirectory
    ? path.join(workingDirectory, "v4-browser-profile")
    : undefined;
  if (browserUserDataDir) {
    fs.mkdirSync(browserUserDataDir, { recursive: true });
  }
  const env = { ...process.env };
  delete env[STAGEHAND_V4_SDK_PATH_ENV];

  const child = forkProcess(bridgePath, [], {
    cwd: workingDirectory,
    detached: process.platform !== "win32",
    env,
    execArgv: ["--import", import.meta.resolve("tsx")],
    serialization: "advanced",
    stdio: [
      "ignore",
      input.inheritChildLogs ? "inherit" : "ignore",
      input.inheritChildLogs ? "inherit" : "ignore",
      "ipc",
    ],
  });
  const controller = new IpcV4CodeController(child, {
    startupTimeoutMs: input.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    executeTimeoutMs: input.executeTimeoutMs ?? DEFAULT_EXECUTE_TIMEOUT_MS,
    closeTimeoutMs: input.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS,
    onConsole: input.onConsole,
    killProcessGroup: process.platform !== "win32",
    browserPidFile: browserUserDataDir
      ? path.join(browserUserDataDir, "chrome.pid")
      : undefined,
  });

  try {
    await controller.initialize(sdkPath, browserUserDataDir);
    return controller;
  } catch (error) {
    await controller.abort();
    throw error;
  }
}

export function resolveV4CodeBridgePath(
  repoRoot: string = getRepoRootDir(),
): string {
  const bridgePath = path.join(
    repoRoot,
    "packages",
    "evals",
    "framework",
    "v4CodeBridge.ts",
  );
  if (!fs.existsSync(bridgePath) || !fs.statSync(bridgePath).isFile()) {
    throw new Error(`V4 code bridge entry file is missing: ${bridgePath}`);
  }
  return bridgePath;
}

class IpcV4CodeController implements V4CodeController {
  readonly #pending = new Map<number, PendingRequest>();
  readonly #exitPromise: Promise<void>;
  readonly #startupTimeoutMs: number;
  readonly #executeTimeoutMs: number;
  readonly #closeTimeoutMs: number;
  readonly #onConsole: ((event: V4CodeBridgeConsoleEvent) => void) | undefined;
  readonly #killProcessGroup: boolean;
  readonly #browserPidFile: string | undefined;
  readonly #parentExitHandler: () => void;
  #browserPid: number | undefined;
  #nextRequestId = 1;
  #closed = false;
  #closeAcknowledged = false;
  #exited = false;
  #terminalError: Error | undefined;
  #closePromise: Promise<void> | undefined;
  #stopPromise: Promise<void> | undefined;

  constructor(
    readonly child: ChildProcess,
    timeouts: {
      startupTimeoutMs: number;
      executeTimeoutMs: number;
      closeTimeoutMs: number;
      onConsole?: (event: V4CodeBridgeConsoleEvent) => void;
      killProcessGroup: boolean;
      browserPidFile?: string;
    },
  ) {
    this.#startupTimeoutMs = requirePositiveTimeout(
      timeouts.startupTimeoutMs,
      "startupTimeoutMs",
    );
    this.#executeTimeoutMs = requirePositiveTimeout(
      timeouts.executeTimeoutMs,
      "executeTimeoutMs",
    );
    this.#closeTimeoutMs = requirePositiveTimeout(
      timeouts.closeTimeoutMs,
      "closeTimeoutMs",
    );
    this.#onConsole = timeouts.onConsole;
    this.#killProcessGroup = timeouts.killProcessGroup;
    this.#browserPidFile = timeouts.browserPidFile;
    this.#parentExitHandler = () => this.#signalProcesses("SIGKILL");
    process.once("exit", this.#parentExitHandler);
    this.#exitPromise = new Promise((resolve) => {
      child.once("exit", (code, signal) => {
        this.#exited = true;
        process.removeListener("exit", this.#parentExitHandler);
        const error = new Error(
          `V4 code bridge exited unexpectedly (code=${String(code)}, signal=${String(signal)}).`,
        );
        if (!this.#closeAcknowledged) {
          this.#fail(error);
          this.#signalProcesses("SIGKILL");
        }
        resolve();
      });
    });
    child.on("message", (message: unknown) => this.#onMessage(message));
    child.once("error", (error) => this.#fail(error));
  }

  async initialize(sdkPath: string, userDataDir?: string): Promise<void> {
    const result = await this.#request(
      { type: "init", sdkPath, ...(userDataDir && { userDataDir }) },
      this.#startupTimeoutMs,
    );
    if (
      isRecord(result) &&
      typeof result.browserPid === "number" &&
      Number.isSafeInteger(result.browserPid) &&
      result.browserPid > 0
    ) {
      this.#browserPid = result.browserPid;
    }
  }

  execute(input: {
    code: string;
    startUrl: string;
    task: Record<string, unknown>;
  }): Promise<unknown> {
    return this.#request({ type: "execute", ...input }, this.#executeTimeoutMs);
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closePromise = this.#close();
    return this.#closePromise;
  }

  async abort(): Promise<void> {
    this.#closed = true;
    this.#fail(new Error("V4 code bridge startup was aborted."));
    await this.#stopChild();
  }

  async #close(): Promise<void> {
    if (this.#closed) return;
    try {
      if (!this.#exited && !this.#terminalError) {
        await this.#request({ type: "close" }, this.#closeTimeoutMs);
      }
    } finally {
      this.#closed = true;
      await this.#stopChild();
    }
  }

  #request(
    request: V4CodeBridgeRequestPayload,
    timeoutMs: number,
  ): Promise<unknown> {
    if (this.#closed) {
      return Promise.reject(new Error("V4 code bridge is closed."));
    }
    if (this.#terminalError) return Promise.reject(this.#terminalError);
    if (!this.child.connected) {
      return Promise.reject(new Error("V4 code bridge IPC channel is closed."));
    }

    const id = this.#nextRequestId++;
    const message = { id, ...request } as V4CodeBridgeRequest;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        const error = new Error(
          `V4 code bridge ${request.type} timed out after ${timeoutMs}ms.`,
        );
        reject(error);
        this.#fail(error);
        void this.#stopChild();
      }, timeoutMs);
      this.#pending.set(id, {
        requestType: request.type,
        resolve,
        reject,
        timer,
      });

      this.child.send(message, (error) => {
        if (!error) return;
        const pending = this.#pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(id);
        pending.reject(error);
        this.#fail(error);
      });
    });
  }

  #onMessage(message: unknown): void {
    if (isV4CodeBridgeConsoleEvent(message)) {
      this.#onConsole?.(message);
      return;
    }
    if (!isV4CodeBridgeResponse(message)) return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(message.id);

    if (message.ok === true) {
      if (pending.requestType === "close") this.#closeAcknowledged = true;
      pending.resolve(message.result);
      return;
    }
    const error = new Error(
      `V4 code bridge ${pending.requestType} failed: ${message.error.message}`,
    );
    error.name = message.error.name;
    if (message.error.stack) error.stack = message.error.stack;
    pending.reject(error);
  }

  #fail(error: Error): void {
    this.#terminalError ??= error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.#terminalError);
    }
    this.#pending.clear();
  }

  async #stopChild(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopPromise = this.#stopChildOnce();
    return this.#stopPromise;
  }

  async #stopChildOnce(): Promise<void> {
    if (this.#exited) {
      if (!this.#closeAcknowledged) this.#signalBrowser("SIGKILL");
      process.removeListener("exit", this.#parentExitHandler);
      return;
    }
    if (this.child.connected) {
      try {
        this.child.disconnect();
      } catch {
        // The child may have disconnected between the connected check and call.
      }
    }
    await waitForExit(this.#exitPromise, CHILD_EXIT_GRACE_MS);
    if (this.#exited) return;
    this.#signalProcesses("SIGTERM");
    await waitForExit(this.#exitPromise, CHILD_EXIT_GRACE_MS);
    if (!this.#exited) this.#signalProcesses("SIGKILL");
    process.removeListener("exit", this.#parentExitHandler);
  }

  #signalProcesses(signal: NodeJS.Signals): void {
    this.#signalBrowser(signal);
    this.#signalChild(signal);
  }

  #signalBrowser(signal: NodeJS.Signals): void {
    const pid = this.#resolveBrowserPid();
    if (!pid) return;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
      return;
    }
    try {
      process.kill(-pid, signal);
    } catch {
      // Chrome may already have been closed by the bridge's graceful cleanup.
    }
  }

  #resolveBrowserPid(): number | undefined {
    if (this.#browserPid) return this.#browserPid;
    if (!this.#browserPidFile || !fs.existsSync(this.#browserPidFile)) {
      return undefined;
    }
    const parsed = Number(fs.readFileSync(this.#browserPidFile, "utf8").trim());
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined;
    this.#browserPid = parsed;
    return parsed;
  }

  #signalChild(signal: NodeJS.Signals): void {
    if (this.#killProcessGroup && this.child.pid) {
      try {
        process.kill(-this.child.pid, signal);
        return;
      } catch {
        // Fall through when the process group has exited or is unavailable.
      }
    }
    try {
      this.child.kill(signal);
    } catch {
      // The child may have exited between the lifecycle check and signal.
    }
  }
}

function isV4CodeBridgeConsoleEvent(
  value: unknown,
): value is V4CodeBridgeConsoleEvent {
  return (
    isRecord(value) &&
    value.type === "console" &&
    typeof value.requestId === "number" &&
    (value.level === "log" ||
      value.level === "warn" ||
      value.level === "error") &&
    typeof value.message === "string"
  );
}

function isV4CodeBridgeResponse(value: unknown): value is V4CodeBridgeResponse {
  if (!isRecord(value) || typeof value.id !== "number") return false;
  if (value.ok === true) return true;
  return (
    value.ok === false &&
    isRecord(value.error) &&
    typeof value.error.name === "string" &&
    typeof value.error.message === "string"
  );
}

function requirePositiveTimeout(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function requireDirectory(value: string, name: string): string {
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`${name} does not point to a directory: ${resolved}`);
  }
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function waitForExit(
  exitPromise: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void exitPromise.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
