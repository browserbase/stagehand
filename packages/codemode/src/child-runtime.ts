import { fork, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Browserbase from "@browserbasehq/sdk";
import type {
  CodeRuntime,
  RuntimeRunResult,
  RuntimeStatus,
  StagehandCodeRuntimeConfig,
} from "./types.js";
import { CodeModeRuntimeError } from "./types.js";
import type { ChildRequest, ChildResponse } from "./runtime-protocol.js";

type ChildRequestWithoutId = ChildRequest extends infer Request
  ? Request extends { id: string }
    ? Omit<Request, "id">
    : never
  : never;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const CHILD_EXIT_GRACE_MS = 2_000;
const PARENT_WATCHDOG_GRACE_MS = 250;
const CONFIGURE_TIMEOUT_MS = 120_000;
const BROWSERBASE_RELEASE_SWEEP_DELAYS_MS = [0, 500, 1_500] as const;

type RequestControl = {
  hardTimeoutMs?: number;
  terminateOnAbort?: boolean;
  timeoutError?: () => CodeModeRuntimeError;
};

export type StagehandChildRuntimeOptions = {
  childModuleUrl?: URL;
};

export class StagehandChildRuntime implements CodeRuntime {
  private child?: ChildProcess;
  private configurePromise?: Promise<void>;
  private readonly pending = new Map<string, PendingRequest>();
  private closePromise?: Promise<void>;
  private forceTerminationPromise?: Promise<void>;
  private browserbaseReleasePromise?: Promise<void>;
  private closed = false;

  constructor(
    private readonly codeSessionId: string,
    private readonly config: StagehandCodeRuntimeConfig,
    private readonly options: StagehandChildRuntimeOptions = {},
  ) {}

  async run(code: string, timeoutMs: number, signal?: AbortSignal): Promise<RuntimeRunResult> {
    await this.ensureConfigured(signal);
    return (await this.request({ type: "run", code, timeoutMs }, signal, false, {
      hardTimeoutMs: timeoutMs + PARENT_WATCHDOG_GRACE_MS,
      terminateOnAbort: true,
      timeoutError: () =>
        new CodeModeRuntimeError("timeout", `Code execution exceeded ${timeoutMs}ms.`, false, {
          mayHaveSideEffects: true,
        }),
    })) as RuntimeRunResult;
  }

  async status(signal?: AbortSignal): Promise<RuntimeStatus> {
    await this.ensureConfigured(signal);
    return (await this.request({ type: "status" }, signal)) as RuntimeStatus;
  }

  async reset(signal?: AbortSignal): Promise<void> {
    await this.ensureConfigured(signal);
    await this.request({ type: "reset" }, signal);
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeInternal();
    return this.closePromise;
  }

  private async closeInternal(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    if (!child) return;
    let acknowledged = false;

    try {
      if (child.connected) {
        await this.request({ type: "close" }, undefined, true, {
          hardTimeoutMs: CHILD_EXIT_GRACE_MS,
          timeoutError: () =>
            new CodeModeRuntimeError(
              "runtime",
              "Stagehand code runtime did not acknowledge close.",
            ),
        });
        acknowledged = true;
      }
    } catch {
      // The child may already be gone. The exit handler rejects pending work.
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
        const grace = new Promise<void>((resolve) => setTimeout(resolve, CHILD_EXIT_GRACE_MS));
        await Promise.race([exited, grace]);
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
      if (!acknowledged) await this.releaseBrowserbaseSessions();
      if (this.child === child) this.child = undefined;
    }
  }

  private async ensureConfigured(signal?: AbortSignal): Promise<void> {
    await this.forceTerminationPromise;
    if (this.closed) {
      throw new CodeModeRuntimeError("closed", "Code session is closed.");
    }
    if (!this.configurePromise) {
      const configurePromise = (async () => {
        this.spawnChild();
        await this.request(
          {
            type: "configure",
            codeSessionId: this.codeSessionId,
            config: this.config,
          },
          signal,
          false,
          {
            hardTimeoutMs: this.config.defaultTimeoutMs ?? CONFIGURE_TIMEOUT_MS,
            terminateOnAbort: true,
            timeoutError: () =>
              new CodeModeRuntimeError(
                "runtime",
                "Stagehand code runtime configuration timed out.",
                true,
              ),
          },
        );
      })();
      this.configurePromise = configurePromise;
      void configurePromise.catch(() => {
        if (this.configurePromise === configurePromise) this.configurePromise = undefined;
      });
    }
    await this.configurePromise;
  }

  private spawnChild(): void {
    if (this.child) return;
    this.forceTerminationPromise = undefined;
    const modulePath = fileURLToPath(
      this.options.childModuleUrl ?? new URL("./runtime-child.mjs", import.meta.url),
    );
    const child = fork(modulePath, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: [],
    });
    this.child = child;
    child.stdout?.on("data", (chunk) => process.stderr.write(`[codemode child] ${chunk}`));
    child.stderr?.on("data", (chunk) => process.stderr.write(`[codemode child] ${chunk}`));
    child.on("message", (message) => this.handleMessage(message));
    child.once("exit", (code, signal) => {
      const error = new CodeModeRuntimeError(
        "runtime",
        `Stagehand code runtime exited${signal ? ` with signal ${signal}` : ` with code ${code}`}.`,
        true,
      );
      const pendingRequests = [...this.pending.values()];
      this.pending.clear();
      if (this.child === child) {
        this.child = undefined;
        if (!this.closed) this.configurePromise = undefined;
      }
      if (this.closed) {
        for (const pending of pendingRequests) pending.reject(error);
        return;
      }
      const recovery = this.forceTerminationPromise ?? this.forceTerminate();
      void recovery.then(
        () => {
          for (const pending of pendingRequests) pending.reject(error);
        },
        () => {
          for (const pending of pendingRequests) pending.reject(error);
        },
      );
    });
    child.once("error", (error) => {
      const pendingRequests = [...this.pending.values()];
      this.pending.clear();
      const recovery = this.forceTerminate();
      void recovery.then(
        () => {
          for (const pending of pendingRequests) pending.reject(error);
        },
        () => {
          for (const pending of pendingRequests) pending.reject(error);
        },
      );
    });
  }

  private handleMessage(message: unknown): void {
    if (!isChildResponse(message)) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) {
      pending.resolve(message.result);
      return;
    }
    const error = new CodeModeRuntimeError(
      message.error.kind,
      message.error.message,
      message.error.retryable,
      {
        cause: message.error,
        mayHaveSideEffects: message.error.mayHaveSideEffects,
      },
    );
    if (message.error.kind !== "timeout") {
      pending.reject(error);
      return;
    }
    const recovery = this.forceTerminate();
    void recovery.then(
      () => pending.reject(error),
      () => pending.reject(error),
    );
  }

  private request(
    request: ChildRequestWithoutId,
    signal?: AbortSignal,
    allowClosed = false,
    control: RequestControl = {},
  ): Promise<unknown> {
    if (this.closed && !allowClosed) {
      return Promise.reject(new CodeModeRuntimeError("closed", "Code session is closed."));
    }
    const child = this.child;
    if (!child?.connected) {
      return Promise.reject(
        new CodeModeRuntimeError("runtime", "Stagehand code runtime is not connected.", true),
      );
    }
    if (signal?.aborted) {
      if (control.terminateOnAbort) void this.forceTerminate();
      return Promise.reject(
        new CodeModeRuntimeError("aborted", "Code execution was aborted.", true, {
          cause: signal.reason,
        }),
      );
    }

    const id = randomUUID();
    return new Promise((resolve, reject) => {
      let watchdog: NodeJS.Timeout | undefined;
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        if (watchdog) clearTimeout(watchdog);
      };
      const onAbort = () => {
        if (!this.pending.delete(id)) return;
        cleanup();
        if (control.terminateOnAbort) void this.forceTerminate();
        reject(
          new CodeModeRuntimeError("aborted", "Code execution was aborted.", false, {
            cause: signal?.reason,
            mayHaveSideEffects: true,
          }),
        );
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
      if (control.hardTimeoutMs !== undefined) {
        watchdog = setTimeout(() => {
          if (!this.pending.delete(id)) return;
          cleanup();
          void this.forceTerminate();
          reject(
            control.timeoutError?.() ??
              new CodeModeRuntimeError("runtime", "Stagehand child request timed out."),
          );
        }, control.hardTimeoutMs);
      }
      child.send({ ...request, id } as ChildRequest, (error) => {
        if (!error) return;
        this.pending.delete(id);
        cleanup();
        void this.forceTerminate();
        reject(error);
      });
    });
  }

  private forceTerminate(): Promise<void> {
    this.forceTerminationPromise ??= (async () => {
      const child = this.child;
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
        child.kill("SIGKILL");
        const grace = new Promise<void>((resolve) => setTimeout(resolve, CHILD_EXIT_GRACE_MS));
        await Promise.race([exited, grace]);
      }
      if (this.child === child) this.child = undefined;
      if (!this.closed) this.configurePromise = undefined;
      await this.releaseBrowserbaseSessions();
    })();
    return this.forceTerminationPromise;
  }

  private releaseBrowserbaseSessions(): Promise<void> {
    if (this.browserbaseReleasePromise) return this.browserbaseReleasePromise;
    const release = this.releaseBrowserbaseSessionsInternal();
    this.browserbaseReleasePromise = release;
    void release.finally(() => {
      if (this.browserbaseReleasePromise === release) this.browserbaseReleasePromise = undefined;
    });
    return release;
  }

  private async releaseBrowserbaseSessionsInternal(): Promise<void> {
    const apiKey = this.config.browserbaseApiKey;
    if (!apiKey) return;
    const browserbase = new Browserbase({ apiKey });
    let lastError: unknown;
    for (const delayMs of BROWSERBASE_RELEASE_SWEEP_DELAYS_MS) {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        const sessionIds = (
          await browserbase.sessions.list({
            status: "RUNNING",
          })
        )
          .filter(
            (session) =>
              session.userMetadata?.integration === "stagehand-codemode-mcp" &&
              session.userMetadata?.codeSessionHash === this.codeSessionHash,
          )
          .map((session) => session.id);
        await Promise.all(
          sessionIds.map((sessionId) =>
            browserbase.sessions.update(sessionId, { status: "REQUEST_RELEASE" }),
          ),
        );
        lastError = undefined;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError !== undefined) {
      const message =
        lastError instanceof Error
          ? lastError.message
          : typeof lastError === "string"
            ? lastError
            : "Unknown Browserbase API error.";
      process.stderr.write(`Failed to release a Stagehand code-mode browser: ${message}\n`);
    }
  }

  private get codeSessionHash(): string {
    return createHash("sha256").update(this.codeSessionId).digest("hex").slice(0, 16);
  }
}

function isChildResponse(value: unknown): value is ChildResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "ok" in value &&
    typeof value.ok === "boolean"
  );
}

export function createStagehandChildRuntime(
  codeSessionId: string,
  config: StagehandCodeRuntimeConfig,
): CodeRuntime {
  return new StagehandChildRuntime(codeSessionId, config);
}
