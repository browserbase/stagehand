import {
  fork as nodeFork,
  spawnSync,
  type ChildProcess,
  type ForkOptions,
} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRootDir } from "../runtimePaths.js";
import {
  STAGEHAND_V4_SDK_PATH_ENV,
  resolveV4SdkPath,
  type V4CodeBrowserbaseResources,
  type V4CodeBrowserConfig,
  type V4CodeMode,
  type V4CodeModelConfig,
} from "./v4CodeConfig.js";
import {
  cleanupV4CodeBrowserbaseResources,
  cleanupV4CodeBrowserbaseResourcesSync,
  type V4CodeBrowserbaseCleanupInput,
} from "./v4CodeBrowserbaseCleanup.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const BRIDGE_READY_TIMEOUT_MS = 30_000;
const DEFAULT_EXECUTE_TIMEOUT_MS = 60_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;
const CHILD_EXIT_GRACE_MS = 1_000;

export type V4CodeBridgeRequest =
  | ({
      id: number;
      type: "init";
      sdkPath: string;
      browser: V4CodeBrowserConfig;
    } & ({ mode: "deterministic" } | { mode: "ai"; model: V4CodeModelConfig }))
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

export function stringifyV4CodeConsoleValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) return serialized;
  } catch {
    // Fall through to primitive coercion.
  }
  try {
    return String(value);
  } catch {
    return "[unserializable value]";
  }
}

export type V4CodeBridgeLifecycleEvent =
  | { type: "bridge_ready" }
  | {
      type: "browserbase_resources";
      resources: V4CodeBrowserbaseResources;
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
  getBrowserbaseResources(): Readonly<V4CodeBrowserbaseResources> | undefined;
  close(): Promise<void>;
}

export type V4CodeBridgeFork = (
  modulePath: string,
  args: readonly string[],
  options: ForkOptions,
) => ChildProcess;

export interface StartV4CodeControllerInput {
  mode?: V4CodeMode;
  model?: V4CodeModelConfig;
  browser?: V4CodeBrowserConfig;
  sdkPath?: string;
  bridgePath?: string;
  forkProcess?: V4CodeBridgeFork;
  inheritChildLogs?: boolean;
  workingDirectory?: string;
  onConsole?: (event: V4CodeBridgeConsoleEvent) => void;
  startupTimeoutMs?: number;
  executeTimeoutMs?: number;
  closeTimeoutMs?: number;
  cleanupBrowserbaseResources?: (
    input: V4CodeBrowserbaseCleanupInput,
  ) => Promise<void>;
  cleanupBrowserbaseResourcesSync?: (
    input: V4CodeBrowserbaseCleanupInput,
  ) => void;
  onCleanupWarning?: (error: Error) => void;
  onCloseWarning?: (error: Error) => void;
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
  const mode = input.mode ?? "deterministic";
  const model = resolveControllerModel(mode, input.model);
  const sdkPath = input.sdkPath ?? resolveV4SdkPath();
  const bridgePath = input.bridgePath ?? resolveV4CodeBridgePath();
  const forkProcess = input.forkProcess ?? nodeFork;
  const configuredBrowser = input.browser ?? { type: "local" as const };
  const workingDirectory = input.workingDirectory
    ? requireDirectory(input.workingDirectory, "workingDirectory")
    : undefined;
  const startupTimeoutMs = requirePositiveTimeout(
    input.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    "startupTimeoutMs",
  );
  const executeTimeoutMs = requirePositiveTimeout(
    input.executeTimeoutMs ?? DEFAULT_EXECUTE_TIMEOUT_MS,
    "executeTimeoutMs",
  );
  const closeTimeoutMs = requirePositiveTimeout(
    input.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS,
    "closeTimeoutMs",
  );
  const browserUserDataDir =
    configuredBrowser.type === "local"
      ? (configuredBrowser.userDataDir ??
        (workingDirectory
          ? path.join(workingDirectory, "v4-browser-profile")
          : fs.mkdtempSync(
              path.join(os.tmpdir(), "stagehand-evals-v4-profile-"),
            )))
      : undefined;
  const ownedBrowserUserDataDir =
    configuredBrowser.type === "local" &&
    !configuredBrowser.userDataDir &&
    !workingDirectory
      ? browserUserDataDir
      : undefined;
  if (browserUserDataDir) {
    fs.mkdirSync(browserUserDataDir, { recursive: true });
  }
  const env = { ...process.env };
  for (const key of [
    STAGEHAND_V4_SDK_PATH_ENV,
    "BROWSERBASE_API_KEY",
    "BROWSERBASE_PROJECT_ID",
    "BB_API_KEY",
    "BB_PROJECT_ID",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_API_KEY",
    "GROQ_API_KEY",
    "CEREBRAS_API_KEY",
  ]) {
    delete env[key];
  }

  let child: ChildProcess;
  try {
    child = forkProcess(bridgePath, [], {
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
  } catch (error) {
    if (ownedBrowserUserDataDir) {
      fs.rmSync(ownedBrowserUserDataDir, { recursive: true, force: true });
    }
    throw error;
  }
  const controller = new IpcV4CodeController(child, {
    startupTimeoutMs,
    executeTimeoutMs,
    closeTimeoutMs,
    onConsole: input.onConsole,
    killProcessGroup: process.platform !== "win32",
    browserPidFile: browserUserDataDir
      ? path.join(browserUserDataDir, "chrome.pid")
      : undefined,
    ownedBrowserUserDataDir,
    browserbase:
      configuredBrowser.type === "browserbase"
        ? {
            apiKey: configuredBrowser.apiKey,
            ...(configuredBrowser.projectId && {
              projectId: configuredBrowser.projectId,
            }),
          }
        : undefined,
    cleanupBrowserbaseResources:
      input.cleanupBrowserbaseResources ?? cleanupV4CodeBrowserbaseResources,
    cleanupBrowserbaseResourcesSync:
      input.cleanupBrowserbaseResourcesSync ??
      cleanupV4CodeBrowserbaseResourcesSync,
    onCleanupWarning: input.onCleanupWarning,
    onCloseWarning: input.onCloseWarning,
  });

  try {
    await controller.initialize({
      sdkPath,
      browser:
        configuredBrowser.type === "local"
          ? {
              type: "local",
              ...(browserUserDataDir && { userDataDir: browserUserDataDir }),
            }
          : configuredBrowser,
      mode,
      model,
    });
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
  readonly #ownedBrowserUserDataDir: string | undefined;
  readonly #browserbase: { apiKey: string; projectId?: string } | undefined;
  readonly #cleanupBrowserbaseResources: (
    input: V4CodeBrowserbaseCleanupInput,
  ) => Promise<void>;
  readonly #cleanupBrowserbaseResourcesSync: (
    input: V4CodeBrowserbaseCleanupInput,
  ) => void;
  readonly #parentExitHandler: () => void;
  readonly #onCleanupWarning: ((error: Error) => void) | undefined;
  readonly #onCloseWarning: ((error: Error) => void) | undefined;
  readonly #bridgeReadyPromise: Promise<void>;
  #resolveBridgeReady!: () => void;
  #rejectBridgeReady!: (error: Error) => void;
  #bridgeReady = false;
  #browserPid: number | undefined;
  #browserbaseResources: V4CodeBrowserbaseResources = {};
  #resourceGeneration = 0;
  #cleanedResourceGeneration = 0;
  #nextRequestId = 1;
  #closed = false;
  #closeAcknowledged = false;
  #exited = false;
  #terminalError: Error | undefined;
  #closePromise: Promise<void> | undefined;
  #stopPromise: Promise<void> | undefined;
  #remoteCleanupPromise: Promise<void> | undefined;
  #cleanupRequestedDuringPass = false;
  #remoteCleanupSyncStarted = false;
  #parentExitArmed = false;

  constructor(
    readonly child: ChildProcess,
    timeouts: {
      startupTimeoutMs: number;
      executeTimeoutMs: number;
      closeTimeoutMs: number;
      onConsole?: (event: V4CodeBridgeConsoleEvent) => void;
      killProcessGroup: boolean;
      browserPidFile?: string;
      ownedBrowserUserDataDir?: string;
      browserbase?: { apiKey: string; projectId?: string };
      cleanupBrowserbaseResources: (
        input: V4CodeBrowserbaseCleanupInput,
      ) => Promise<void>;
      cleanupBrowserbaseResourcesSync: (
        input: V4CodeBrowserbaseCleanupInput,
      ) => void;
      onCleanupWarning?: (error: Error) => void;
      onCloseWarning?: (error: Error) => void;
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
    this.#ownedBrowserUserDataDir = timeouts.ownedBrowserUserDataDir;
    this.#browserbase = timeouts.browserbase;
    this.#cleanupBrowserbaseResources = timeouts.cleanupBrowserbaseResources;
    this.#cleanupBrowserbaseResourcesSync =
      timeouts.cleanupBrowserbaseResourcesSync;
    this.#onCleanupWarning = timeouts.onCleanupWarning;
    this.#onCloseWarning = timeouts.onCloseWarning;
    this.#parentExitHandler = () => {
      this.#signalProcesses("SIGKILL");
      this.#cleanupRemoteSync();
    };
    this.#bridgeReadyPromise = new Promise((resolve, reject) => {
      this.#resolveBridgeReady = resolve;
      this.#rejectBridgeReady = reject;
    });
    this.#armParentExit();
    this.#exitPromise = new Promise((resolve) => {
      child.once("exit", (code, signal) => {
        this.#exited = true;
        const error = new Error(
          `V4 code bridge exited unexpectedly (code=${String(code)}, signal=${String(signal)}).`,
        );
        if (!this.#closeAcknowledged) {
          this.#fail(error);
          this.#signalProcesses("SIGKILL");
          void this.#cleanupRemote().then(() => {
            this.#disarmParentExitIfSafe();
          });
        } else {
          this.#disarmParentExitIfSafe();
        }
        resolve();
      });
    });
    child.on("message", (message: unknown) => this.#onMessage(message));
    child.once("error", (error) => this.#fail(error));
  }

  async initialize(input: {
    sdkPath: string;
    browser: V4CodeBrowserConfig;
    mode: V4CodeMode;
    model?: V4CodeModelConfig;
  }): Promise<void> {
    await this.#waitForBridgeReady();
    const result = await this.#request(
      input.mode === "ai"
        ? {
            type: "init",
            sdkPath: input.sdkPath,
            browser: input.browser,
            mode: "ai",
            model: requireControllerModel(input.model),
          }
        : {
            type: "init",
            sdkPath: input.sdkPath,
            browser: input.browser,
            mode: "deterministic",
          },
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
    if (isRecord(result) && isV4CodeBrowserbaseResources(result.resources)) {
      this.#recordBrowserbaseResources(result.resources);
    }
  }

  execute(input: {
    code: string;
    startUrl: string;
    task: Record<string, unknown>;
  }): Promise<unknown> {
    return this.#request({ type: "execute", ...input }, this.#executeTimeoutMs);
  }

  getBrowserbaseResources(): Readonly<V4CodeBrowserbaseResources> | undefined {
    if (
      !this.#browserbaseResources.sessionId &&
      !this.#browserbaseResources.extensionId
    ) {
      return undefined;
    }
    return { ...this.#browserbaseResources };
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
    let closeError: Error | undefined;
    try {
      if (!this.#exited && !this.#terminalError) {
        await this.#request({ type: "close" }, this.#closeTimeoutMs);
      }
    } catch (error) {
      closeError = error instanceof Error ? error : new Error(String(error));
    } finally {
      this.#closed = true;
      await this.#stopChild();
    }
    if (!closeError) return;
    if (this.#hasCleanedLatestRemoteResources()) {
      this.#emitCloseWarning(closeError);
      return;
    }
    throw closeError;
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
    if (isV4CodeBridgeLifecycleEvent(message)) {
      if (message.type === "bridge_ready") {
        if (!this.#bridgeReady) {
          this.#bridgeReady = true;
          this.#resolveBridgeReady();
        }
      } else {
        this.#recordBrowserbaseResources(message.resources);
      }
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
    this.#rejectBridgeReady(this.#terminalError);
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.#terminalError);
    }
    this.#pending.clear();
  }

  async #stopChild(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopPromise = this.#stopChildOnce().finally(() => {
      if (this.#ownedBrowserUserDataDir) {
        fs.rmSync(this.#ownedBrowserUserDataDir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      }
    });
    return this.#stopPromise;
  }

  async #waitForBridgeReady(): Promise<void> {
    if (this.#bridgeReady) return;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `V4 code bridge startup timed out after ${BRIDGE_READY_TIMEOUT_MS}ms.`,
          ),
        );
      }, BRIDGE_READY_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.#bridgeReadyPromise, timeout]);
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      this.#fail(normalized);
      void this.#stopChild();
      throw normalized;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async #stopChildOnce(): Promise<void> {
    try {
      if (this.#exited) {
        if (!this.#closeAcknowledged) this.#signalBrowser("SIGKILL");
        return;
      }
      if (this.child.connected && !this.#browserbase) {
        try {
          this.child.disconnect();
        } catch {
          // The child may have disconnected between the connected check and call.
        }
      }
      if (this.#browserbase) this.#signalChild("SIGTERM");
      await waitForExit(this.#exitPromise, CHILD_EXIT_GRACE_MS);
      if (this.#exited) return;
      this.#signalProcesses("SIGTERM");
      await waitForExit(this.#exitPromise, CHILD_EXIT_GRACE_MS);
      if (!this.#exited) {
        this.#signalProcesses("SIGKILL");
        await waitForExit(this.#exitPromise, CHILD_EXIT_GRACE_MS);
      }
      await waitForIpcDrain();
    } finally {
      if (!this.#closeAcknowledged) await this.#cleanupRemote();
      this.#disarmParentExitIfSafe();
    }
  }

  #recordBrowserbaseResources(resources: V4CodeBrowserbaseResources): void {
    let changed = false;
    if (
      resources.sessionId &&
      resources.sessionId !== this.#browserbaseResources.sessionId
    ) {
      this.#browserbaseResources.sessionId = resources.sessionId;
      changed = true;
    }
    if (
      resources.extensionId &&
      resources.extensionId !== this.#browserbaseResources.extensionId
    ) {
      this.#browserbaseResources.extensionId = resources.extensionId;
      changed = true;
    }
    if (!changed) return;
    this.#resourceGeneration += 1;
    if (this.#remoteCleanupPromise) {
      this.#cleanupRequestedDuringPass = true;
    } else if (this.#shouldFallbackCleanup()) {
      this.#armParentExit();
      void this.#cleanupRemote().then(() => {
        this.#disarmParentExitIfSafe();
      });
    }
  }

  #cleanupRemote(): Promise<void> {
    if (this.#remoteCleanupPromise) {
      return this.#remoteCleanupPromise;
    }
    if (
      !this.#browserbase ||
      this.#cleanedResourceGeneration >= this.#resourceGeneration
    ) {
      return Promise.resolve();
    }
    const cleanup = this.#drainRemoteCleanup();
    this.#remoteCleanupPromise = cleanup;
    const onSettled = (): void => {
      if (this.#remoteCleanupPromise === cleanup) {
        this.#remoteCleanupPromise = undefined;
        if (
          this.#shouldFallbackCleanup() &&
          this.#cleanupRequestedDuringPass &&
          this.#cleanedResourceGeneration < this.#resourceGeneration
        ) {
          this.#armParentExit();
          void this.#cleanupRemote().then(() => {
            this.#disarmParentExitIfSafe();
          });
          return;
        }
        this.#disarmParentExitIfSafe();
      }
    };
    void cleanup.then(onSettled, onSettled);
    return cleanup;
  }

  async #drainRemoteCleanup(): Promise<void> {
    while (
      this.#browserbase &&
      this.#cleanedResourceGeneration < this.#resourceGeneration
    ) {
      this.#cleanupRequestedDuringPass = false;
      const generation = this.#resourceGeneration;
      const resources = { ...this.#browserbaseResources };
      try {
        await this.#cleanupBrowserbaseResources({
          ...this.#browserbase,
          resources,
        });
        this.#cleanedResourceGeneration = generation;
      } catch (error) {
        this.#emitCleanupWarning(error);
        if (this.#resourceGeneration <= generation) return;
      }
      if (
        !this.#cleanupRequestedDuringPass &&
        this.#cleanedResourceGeneration >= this.#resourceGeneration
      ) {
        return;
      }
    }
  }

  #emitCleanupWarning(error: unknown): void {
    try {
      this.#onCleanupWarning?.(
        error instanceof Error
          ? error
          : new Error("V4 Browserbase fallback cleanup failed."),
      );
    } catch {
      // Cleanup warnings must never replace the primary bridge failure.
    }
  }

  #emitCloseWarning(error: Error): void {
    try {
      this.#onCloseWarning?.(error);
    } catch {
      // Close warnings must never replace verified fallback cleanup.
    }
  }

  #hasCleanedLatestRemoteResources(): boolean {
    return (
      this.#browserbase !== undefined &&
      this.#resourceGeneration > 0 &&
      this.#cleanedResourceGeneration >= this.#resourceGeneration
    );
  }

  #disarmParentExitIfSafe(): void {
    if (
      this.#closeAcknowledged ||
      (this.#exited &&
        this.#cleanedResourceGeneration >= this.#resourceGeneration &&
        !this.#remoteCleanupPromise)
    ) {
      process.removeListener("exit", this.#parentExitHandler);
      this.#parentExitArmed = false;
    }
  }

  #armParentExit(): void {
    if (this.#parentExitArmed) return;
    process.once("exit", this.#parentExitHandler);
    this.#parentExitArmed = true;
  }

  #shouldFallbackCleanup(): boolean {
    return (
      !this.#closeAcknowledged &&
      (this.#closed || this.#terminalError !== undefined || this.#exited)
    );
  }

  #cleanupRemoteSync(): void {
    if (
      this.#closeAcknowledged ||
      this.#remoteCleanupSyncStarted ||
      !this.#browserbase ||
      (!this.#browserbaseResources.sessionId &&
        !this.#browserbaseResources.extensionId)
    ) {
      return;
    }
    this.#remoteCleanupSyncStarted = true;
    this.#cleanupBrowserbaseResourcesSync({
      ...this.#browserbase,
      resources: { ...this.#browserbaseResources },
    });
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

function isV4CodeBridgeLifecycleEvent(
  value: unknown,
): value is V4CodeBridgeLifecycleEvent {
  return (
    isRecord(value) &&
    (value.type === "bridge_ready" ||
      (value.type === "browserbase_resources" &&
        isV4CodeBrowserbaseResources(value.resources)))
  );
}

function isV4CodeBrowserbaseResources(
  value: unknown,
): value is V4CodeBrowserbaseResources {
  return (
    isRecord(value) &&
    (value.sessionId === undefined || typeof value.sessionId === "string") &&
    (value.extensionId === undefined || typeof value.extensionId === "string")
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

function resolveControllerModel(
  mode: V4CodeMode,
  model: V4CodeModelConfig | undefined,
): V4CodeModelConfig | undefined {
  if (mode === "ai") return requireControllerModel(model);
  if (model) {
    throw new Error(
      "Deterministic V4 code must not receive model configuration.",
    );
  }
  return undefined;
}

function requireControllerModel(
  model: V4CodeModelConfig | undefined,
): V4CodeModelConfig {
  if (!model?.modelName.trim() || !model.apiKey.trim()) {
    throw new Error(
      "AI-enabled V4 code requires a model name and provider API key.",
    );
  }
  return model;
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

function waitForIpcDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
