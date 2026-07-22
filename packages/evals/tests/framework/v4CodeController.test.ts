import { EventEmitter } from "node:events";
import type { ChildProcess, ForkOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  startV4CodeController,
  stringifyV4CodeConsoleValue,
  type V4CodeBridgeConsoleEvent,
  type V4CodeBridgeFork,
  type V4CodeBridgeLifecycleEvent,
  type V4CodeBridgeRequest,
  type V4CodeBridgeResponse,
} from "../../framework/v4CodeController.js";
import { STAGEHAND_V4_SDK_PATH_ENV } from "../../framework/v4CodeConfig.js";

class FakeBridgeChild extends EventEmitter {
  connected = true;
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly sent: V4CodeBridgeRequest[] = [];
  disconnectCalls = 0;
  killCalls: Array<NodeJS.Signals | number | undefined> = [];
  onRequest?: (request: V4CodeBridgeRequest) => void;

  send(
    message: V4CodeBridgeRequest,
    callback?: (error: Error | null) => void,
  ): boolean {
    this.sent.push(message);
    queueMicrotask(() => {
      callback?.(null);
      this.onRequest?.(message);
    });
    return true;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    if (!this.connected) return;
    this.connected = false;
    queueMicrotask(() => this.exit(0, null));
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killCalls.push(signal);
    this.killed = true;
    this.exit(null, typeof signal === "string" ? signal : "SIGTERM");
    return true;
  }

  respond(
    response:
      | V4CodeBridgeResponse
      | V4CodeBridgeConsoleEvent
      | V4CodeBridgeLifecycleEvent,
  ): void {
    this.emit("message", response);
  }

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.connected = false;
    this.emit("exit", code, signal);
  }
}

function makeFork(child: FakeBridgeChild): {
  forkProcess: V4CodeBridgeFork;
  calls: Array<{
    modulePath: string;
    args: readonly string[];
    options: ForkOptions;
  }>;
} {
  const calls: Array<{
    modulePath: string;
    args: readonly string[];
    options: ForkOptions;
  }> = [];
  return {
    calls,
    forkProcess: (modulePath, args, options) => {
      calls.push({ modulePath, args, options });
      return child as unknown as ChildProcess;
    },
  };
}

function respondSuccessfully(child: FakeBridgeChild): void {
  child.onRequest = (request) => {
    if (request.type === "execute") {
      child.respond({
        id: request.id,
        ok: true,
        result: { title: "Example Domain" },
      });
      return;
    }
    child.respond({ id: request.id, ok: true });
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeDelayedBrowserbaseSdk(input: {
  uploadDelayMs: number;
  sessionDelayMs: number;
}): { directory: string; sdkPath: string } {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "v4-delayed-browserbase-sdk-"),
  );
  fs.writeFileSync(
    path.join(directory, "index.ts"),
    "export class Stagehand {}\n",
  );
  fs.writeFileSync(
    path.join(directory, "browserbaseSession.ts"),
    `
const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createBrowserbaseApiClient() {
  return {
    async uploadExtension() {
      await wait(${input.uploadDelayMs});
      return { id: "late-extension-resource" };
    },
    async deleteExtension() {},
    async createSession() {
      await wait(${input.sessionDelayMs});
      return {
        id: "late-session-resource",
        connectUrl: "wss://connect.invalid",
      };
    },
    async releaseSession() {},
  };
}

export function createBrowserbaseSessionClient(
  _apiKey: string,
  dependencies: {
    browserbase: ReturnType<typeof createBrowserbaseApiClient>;
  },
) {
  return {
    async createSession(params: Record<string, unknown>) {
      const extension =
        await dependencies.browserbase.uploadExtension("fixture.zip");
      const session = await dependencies.browserbase.createSession({
        ...params,
        extensionId: extension.id,
      });
      return {
        sessionId: session.id,
        cdpUrl: session.connectUrl,
        async close() {
          await dependencies.browserbase.releaseSession();
          await dependencies.browserbase.deleteExtension();
        },
      };
    },
  };
}
`,
  );
  fs.writeFileSync(
    path.join(directory, "browserSource.ts"),
    `
export async function resolveBrowserSource(
  input: { browser: Record<string, unknown> },
  dependencies: {
    browserbase: {
      createSession(params: Record<string, unknown>): Promise<{
        sessionId: string;
        cdpUrl: string;
        close(): Promise<void>;
      }>;
    };
  },
) {
  const session = await dependencies.browserbase.createSession(input.browser);
  return {
    cdpUrl: session.cdpUrl,
    browserbaseSessionId: session.sessionId,
    preloadedExtension: true,
    keepAlive: false,
    close: session.close,
  };
}
`,
  );
  fs.writeFileSync(
    path.join(directory, "stagehand.ts"),
    `
export function createStagehandWithDependenciesForTest(
  options: unknown,
  adapters: {
    resolveBrowserSource(input: unknown): Promise<{ close(): Promise<void> }>;
  },
) {
  const page = { pageId: "fixture-page" };
  let browser: { close(): Promise<void> } | undefined;
  return {
    context: {
      clipboard: {},
      async activePage() { return page; },
      async pages() { return [page]; },
      async newPage() { return page; },
    },
    async init() {
      browser = await adapters.resolveBrowserSource(options);
    },
    async close() {
      await browser?.close();
    },
  };
}
`,
  );
  return { directory, sdkPath: path.join(directory, "index.ts") };
}

describe("V4 code child controller", () => {
  it("initializes, executes by request ID, and closes exactly once", async () => {
    const child = new FakeBridgeChild();
    respondSuccessfully(child);
    const { forkProcess, calls } = makeFork(child);

    const controller = await startV4CodeController({
      sdkPath: "/synthetic/v4-sdk.ts",
      bridgePath: "/synthetic/v4CodeBridge.ts",
      forkProcess,
      startupTimeoutMs: 100,
      executeTimeoutMs: 100,
      closeTimeoutMs: 100,
    });
    const result = await controller.execute({
      code: "return await page.title();",
      startUrl: "https://example.com",
      task: { id: "smoke" },
    });
    const initRequest = child.sent[0];
    expect(initRequest.type).toBe("init");
    if (initRequest.type !== "init") throw new Error("Expected init request");
    expect(initRequest.userDataDir?.startsWith(os.tmpdir())).toBe(true);
    expect(fs.existsSync(initRequest.userDataDir ?? "")).toBe(true);
    await controller.close();
    await controller.close();

    expect(result).toEqual({ title: "Example Domain" });
    expect(child.sent.map((request) => request.type)).toEqual([
      "init",
      "execute",
      "close",
    ]);
    expect(child.sent[0]).toMatchObject({
      type: "init",
      mode: "deterministic",
      browser: { type: "local" },
    });
    expect(new Set(child.sent.map((request) => request.id)).size).toBe(3);
    expect(child.disconnectCalls).toBe(1);
    expect(child.killCalls).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      modulePath: "/synthetic/v4CodeBridge.ts",
      args: [],
      options: {
        detached: process.platform !== "win32",
        execArgv: ["--import", expect.stringContaining("tsx")],
        serialization: "advanced",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    });
    expect(calls[0].options.env?.[STAGEHAND_V4_SDK_PATH_ENV]).toBeUndefined();
    expect(fs.existsSync(initRequest.userDataDir ?? "")).toBe(false);
  });

  it("serializes console values without dropping undefined", () => {
    expect(stringifyV4CodeConsoleValue("text")).toBe("text");
    expect(stringifyV4CodeConsoleValue({ ok: true })).toBe('{"ok":true}');
    expect(stringifyV4CodeConsoleValue(undefined)).toBe("undefined");
    expect(stringifyV4CodeConsoleValue(1n)).toBe("1");
    expect(
      stringifyV4CodeConsoleValue({
        toJSON: () => {
          throw new Error("cannot serialize");
        },
        [Symbol.toPrimitive]: () => {
          throw new Error("cannot coerce");
        },
      }),
    ).toBe("[unserializable value]");
  });

  it("can inherit child stdout and stderr for V4 debugging", async () => {
    const child = new FakeBridgeChild();
    respondSuccessfully(child);
    const { forkProcess, calls } = makeFork(child);

    const controller = await startV4CodeController({
      sdkPath: "/synthetic/v4-sdk.ts",
      bridgePath: "/synthetic/v4CodeBridge.ts",
      forkProcess,
      inheritChildLogs: true,
      startupTimeoutMs: 100,
      executeTimeoutMs: 100,
      closeTimeoutMs: 100,
    });
    await controller.close();

    expect(calls[0].options.stdio).toEqual([
      "ignore",
      "inherit",
      "inherit",
      "ipc",
    ]);
  });

  it("does not make Browserbase or model credentials ambient in the bridge", async () => {
    const credentialNames = [
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
    ];
    const previous = new Map(
      credentialNames.map((name) => [name, process.env[name]]),
    );
    try {
      for (const name of credentialNames) process.env[name] = "secret-value";
      const child = new FakeBridgeChild();
      respondSuccessfully(child);
      const { forkProcess, calls } = makeFork(child);
      const controller = await startV4CodeController({
        sdkPath: "/synthetic/v4-sdk.ts",
        bridgePath: "/synthetic/v4CodeBridge.ts",
        forkProcess,
        startupTimeoutMs: 100,
        executeTimeoutMs: 100,
        closeTimeoutMs: 100,
      });
      await controller.close();

      for (const name of credentialNames) {
        expect(calls[0].options.env?.[name]).toBeUndefined();
      }
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("sends AI mode and model configuration through typed init IPC", async () => {
    const child = new FakeBridgeChild();
    respondSuccessfully(child);
    const { forkProcess } = makeFork(child);

    const controller = await startV4CodeController({
      mode: "ai",
      model: {
        modelName: "anthropic/claude-sonnet-5",
        apiKey: "test-key",
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
      },
      sdkPath: "/synthetic/v4-sdk.ts",
      bridgePath: "/synthetic/v4CodeBridge.ts",
      forkProcess,
      startupTimeoutMs: 100,
      executeTimeoutMs: 100,
      closeTimeoutMs: 100,
    });
    await controller.close();

    expect(child.sent[0]).toMatchObject({
      id: 1,
      type: "init",
      mode: "ai",
      sdkPath: "/synthetic/v4-sdk.ts",
      browser: { type: "local" },
      model: {
        modelName: "anthropic/claude-sonnet-5",
        apiKey: "test-key",
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
      },
    });
  });

  it("rejects missing AI configuration and model leakage into deterministic mode", async () => {
    await expect(
      startV4CodeController({
        mode: "ai",
        sdkPath: "/synthetic/v4-sdk.ts",
        bridgePath: "/synthetic/v4CodeBridge.ts",
      }),
    ).rejects.toThrow(/requires a model name and provider API key/);
    await expect(
      startV4CodeController({
        mode: "deterministic",
        model: {
          modelName: "anthropic/claude-sonnet-5",
          apiKey: "test-key",
        },
        sdkPath: "/synthetic/v4-sdk.ts",
        bridgePath: "/synthetic/v4CodeBridge.ts",
      }),
    ).rejects.toThrow(/must not receive model configuration/);
  });

  it("sets the bridge cwd and forwards typed snippet console events", async () => {
    const child = new FakeBridgeChild();
    respondSuccessfully(child);
    const { forkProcess, calls } = makeFork(child);
    const onConsole = vi.fn();

    const controller = await startV4CodeController({
      sdkPath: "/synthetic/v4-sdk.ts",
      bridgePath: "/synthetic/v4CodeBridge.ts",
      forkProcess,
      workingDirectory: os.tmpdir(),
      onConsole,
      startupTimeoutMs: 100,
      executeTimeoutMs: 100,
      closeTimeoutMs: 100,
    });
    child.respond({
      type: "console",
      requestId: 2,
      level: "log",
      message: "visible through IPC",
    });
    await controller.close();

    expect(calls[0].options.cwd).toBe(os.tmpdir());
    expect(child.sent[0]).toMatchObject({
      type: "init",
      browser: {
        type: "local",
        userDataDir: path.join(os.tmpdir(), "v4-browser-profile"),
      },
    });
    expect(onConsole).toHaveBeenCalledWith({
      type: "console",
      requestId: 2,
      level: "log",
      message: "visible through IPC",
    });
  });

  it("returns child execution errors without poisoning later requests", async () => {
    const child = new FakeBridgeChild();
    child.onRequest = (request) => {
      if (request.type === "init" || request.type === "close") {
        child.respond({ id: request.id, ok: true });
        return;
      }
      child.respond({
        id: request.id,
        ok: false,
        error: { name: "TypeError", message: "page method failed" },
      });
    };
    const { forkProcess } = makeFork(child);
    const controller = await startV4CodeController({
      sdkPath: "/synthetic/v4-sdk.ts",
      bridgePath: "/synthetic/v4CodeBridge.ts",
      forkProcess,
      startupTimeoutMs: 100,
      executeTimeoutMs: 100,
      closeTimeoutMs: 100,
    });

    await expect(
      controller.execute({ code: "throw new Error()", startUrl: "", task: {} }),
    ).rejects.toThrow("V4 code bridge execute failed: page method failed");
    await controller.close();
  });

  it("uses Browserbase without creating a local profile and disarms fallback after close ACK", async () => {
    const workingDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "v4-controller-browserbase-"),
    );
    try {
      const child = new FakeBridgeChild();
      child.onRequest = (request) => {
        if (request.type === "init") {
          child.respond({
            type: "browserbase_resources",
            resources: { extensionId: "extension-resource" },
          });
          child.respond({
            type: "browserbase_resources",
            resources: {
              extensionId: "extension-resource",
              sessionId: "session-resource",
            },
          });
        }
        child.respond({ id: request.id, ok: true });
      };
      const { forkProcess } = makeFork(child);
      const cleanup = vi.fn(async () => {});
      const cleanupSync = vi.fn();
      const controller = await startV4CodeController({
        browser: {
          type: "browserbase",
          apiKey: "private-api-key",
          projectId: "private-project",
          region: "us-west-2",
        },
        sdkPath: "/synthetic/v4-sdk.ts",
        bridgePath: "/synthetic/v4CodeBridge.ts",
        forkProcess,
        workingDirectory,
        cleanupBrowserbaseResources: cleanup,
        cleanupBrowserbaseResourcesSync: cleanupSync,
        startupTimeoutMs: 100,
        executeTimeoutMs: 100,
        closeTimeoutMs: 100,
      });

      expect(child.sent[0]).toEqual({
        id: 1,
        type: "init",
        sdkPath: "/synthetic/v4-sdk.ts",
        mode: "deterministic",
        browser: {
          type: "browserbase",
          apiKey: "private-api-key",
          projectId: "private-project",
          region: "us-west-2",
        },
      });
      expect(controller.getBrowserbaseResources()).toEqual({
        extensionId: "extension-resource",
        sessionId: "session-resource",
      });
      expect(
        fs.existsSync(path.join(workingDirectory, "v4-browser-profile")),
      ).toBe(false);

      await controller.close();
      expect(cleanup).not.toHaveBeenCalled();
      expect(cleanupSync).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("falls back to parent-owned Browserbase cleanup after an unexpected child exit", async () => {
    const existingExitListeners = new Set(process.listeners("exit"));
    const child = new FakeBridgeChild();
    child.onRequest = (request) => {
      if (request.type === "init") {
        child.respond({
          type: "browserbase_resources",
          resources: { extensionId: "extension-resource" },
        });
        child.respond({
          type: "browserbase_resources",
          resources: { sessionId: "session-resource" },
        });
        child.respond({ id: request.id, ok: true });
        return;
      }
      if (request.type === "execute") child.exit(17, null);
    };
    const { forkProcess } = makeFork(child);
    const cleanupError = new Error("cleanup unavailable");
    const cleanup = vi.fn(async () => {
      throw cleanupError;
    });
    const onCleanupWarning = vi.fn();
    const controller = await startV4CodeController({
      browser: {
        type: "browserbase",
        apiKey: "private-api-key",
        projectId: "private-project",
      },
      sdkPath: "/synthetic/v4-sdk.ts",
      bridgePath: "/synthetic/v4CodeBridge.ts",
      forkProcess,
      cleanupBrowserbaseResources: cleanup,
      cleanupBrowserbaseResourcesSync: vi.fn(),
      onCleanupWarning,
      startupTimeoutMs: 100,
      executeTimeoutMs: 100,
      closeTimeoutMs: 100,
    });

    await expect(
      controller.execute({ code: "while (true) {}", startUrl: "", task: {} }),
    ).rejects.toThrow("V4 code bridge exited unexpectedly");
    await controller.close();

    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledWith({
      apiKey: "private-api-key",
      projectId: "private-project",
      resources: {
        extensionId: "extension-resource",
        sessionId: "session-resource",
      },
    });
    expect(onCleanupWarning).toHaveBeenCalledTimes(2);
    expect(onCleanupWarning).toHaveBeenCalledWith(cleanupError);
    for (const listener of process.listeners("exit")) {
      if (!existingExitListeners.has(listener)) {
        process.removeListener("exit", listener);
      }
    }
  });

  it("keeps synchronous parent-exit cleanup armed while asynchronous cleanup is pending", async () => {
    const existingExitListeners = new Set(process.listeners("exit"));
    const child = new FakeBridgeChild();
    child.onRequest = (request) => {
      if (request.type === "init") {
        child.respond({
          type: "browserbase_resources",
          resources: {
            extensionId: "extension-resource",
            sessionId: "session-resource",
          },
        });
        child.respond({ id: request.id, ok: true });
        return;
      }
      if (request.type === "execute") child.exit(17, null);
    };
    const cleanupHeld = deferred();
    const cleanupStarted = deferred();
    const cleanup = vi.fn(async () => {
      cleanupStarted.resolve();
      await cleanupHeld.promise;
    });
    const cleanupSync = vi.fn();
    const { forkProcess } = makeFork(child);
    const controller = await startV4CodeController({
      browser: { type: "browserbase", apiKey: "private-api-key" },
      sdkPath: "/synthetic/v4-sdk.ts",
      bridgePath: "/synthetic/v4CodeBridge.ts",
      forkProcess,
      cleanupBrowserbaseResources: cleanup,
      cleanupBrowserbaseResourcesSync: cleanupSync,
      startupTimeoutMs: 100,
      executeTimeoutMs: 100,
      closeTimeoutMs: 100,
    });

    await expect(
      controller.execute({ code: "while (true) {}", startUrl: "", task: {} }),
    ).rejects.toThrow("V4 code bridge exited unexpectedly");
    await cleanupStarted.promise;

    const parentExitHandler = process
      .listeners("exit")
      .find((listener) => !existingExitListeners.has(listener));
    expect(parentExitHandler).toBeDefined();
    (parentExitHandler as (code: number) => void)(0);
    expect(cleanupSync).toHaveBeenCalledWith({
      apiKey: "private-api-key",
      resources: {
        extensionId: "extension-resource",
        sessionId: "session-resource",
      },
    });

    const close = controller.close();
    cleanupHeld.resolve();
    await close;
    expect(process.listeners("exit")).not.toContain(parentExitHandler);
  });

  it("runs another cleanup pass when a session arrives during failed extension cleanup", async () => {
    const child = new FakeBridgeChild();
    child.onRequest = (request) => {
      if (request.type === "init") {
        child.respond({
          type: "browserbase_resources",
          resources: { extensionId: "extension-resource" },
        });
        child.respond({ id: request.id, ok: true });
        return;
      }
      if (request.type === "execute") child.exit(17, null);
    };
    const firstCleanupHeld = deferred();
    const firstCleanupStarted = deferred();
    const cleanupInputs: unknown[] = [];
    const cleanup = vi.fn(async (cleanupInput) => {
      cleanupInputs.push(cleanupInput);
      if (cleanup.mock.calls.length === 1) {
        firstCleanupStarted.resolve();
        await firstCleanupHeld.promise;
        throw new Error("extension cleanup failed");
      }
    });
    const onCleanupWarning = vi.fn();
    const { forkProcess } = makeFork(child);
    const controller = await startV4CodeController({
      browser: { type: "browserbase", apiKey: "private-api-key" },
      sdkPath: "/synthetic/v4-sdk.ts",
      bridgePath: "/synthetic/v4CodeBridge.ts",
      forkProcess,
      cleanupBrowserbaseResources: cleanup,
      cleanupBrowserbaseResourcesSync: vi.fn(),
      onCleanupWarning,
      startupTimeoutMs: 100,
      executeTimeoutMs: 100,
      closeTimeoutMs: 100,
    });

    await expect(
      controller.execute({ code: "while (true) {}", startUrl: "", task: {} }),
    ).rejects.toThrow("V4 code bridge exited unexpectedly");
    await firstCleanupStarted.promise;
    child.respond({
      type: "browserbase_resources",
      resources: {
        extensionId: "extension-resource",
        sessionId: "session-resource",
      },
    });
    firstCleanupHeld.resolve();
    await controller.close();

    expect(cleanupInputs).toEqual([
      {
        apiKey: "private-api-key",
        resources: { extensionId: "extension-resource" },
      },
      {
        apiKey: "private-api-key",
        resources: {
          extensionId: "extension-resource",
          sessionId: "session-resource",
        },
      },
    ]);
    expect(onCleanupWarning).toHaveBeenCalledTimes(1);
  });

  it("cleans partially provisioned Browserbase resources when init fails", async () => {
    const child = new FakeBridgeChild();
    child.onRequest = (request) => {
      child.respond({
        type: "browserbase_resources",
        resources: { extensionId: "extension-resource" },
      });
      child.respond({
        id: request.id,
        ok: false,
        error: { name: "Error", message: "session creation failed" },
      });
    };
    const { forkProcess } = makeFork(child);
    const cleanup = vi.fn(async () => {});

    await expect(
      startV4CodeController({
        browser: { type: "browserbase", apiKey: "private-api-key" },
        sdkPath: "/synthetic/v4-sdk.ts",
        bridgePath: "/synthetic/v4CodeBridge.ts",
        forkProcess,
        cleanupBrowserbaseResources: cleanup,
        cleanupBrowserbaseResourcesSync: vi.fn(),
        startupTimeoutMs: 100,
        executeTimeoutMs: 100,
        closeTimeoutMs: 100,
      }),
    ).rejects.toThrow("session creation failed");
    expect(cleanup).toHaveBeenCalledWith({
      apiKey: "private-api-key",
      resources: { extensionId: "extension-resource" },
    });
  });

  it("terminates the child when initialization fails", async () => {
    const child = new FakeBridgeChild();
    child.onRequest = (request) => {
      child.respond({
        id: request.id,
        ok: false,
        error: { name: "Error", message: "schema registration failed" },
      });
    };
    const { forkProcess } = makeFork(child);

    await expect(
      startV4CodeController({
        sdkPath: "/synthetic/v4-sdk.ts",
        bridgePath: "/synthetic/v4CodeBridge.ts",
        forkProcess,
        startupTimeoutMs: 100,
        executeTimeoutMs: 100,
        closeTimeoutMs: 100,
      }),
    ).rejects.toThrow("V4 code bridge init failed: schema registration failed");
    expect(child.sent.map((request) => request.type)).toEqual(["init"]);
    expect(child.disconnectCalls).toBe(1);
  });

  it("rejects pending work when the child exits unexpectedly", async () => {
    const child = new FakeBridgeChild();
    child.onRequest = (request) => {
      if (request.type === "init") {
        child.respond({ id: request.id, ok: true });
        return;
      }
      if (request.type === "execute") child.exit(17, null);
    };
    const { forkProcess } = makeFork(child);
    const controller = await startV4CodeController({
      sdkPath: "/synthetic/v4-sdk.ts",
      bridgePath: "/synthetic/v4CodeBridge.ts",
      forkProcess,
      startupTimeoutMs: 100,
      executeTimeoutMs: 100,
      closeTimeoutMs: 100,
    });

    await expect(
      controller.execute({ code: "return 1", startUrl: "", task: {} }),
    ).rejects.toThrow(
      "V4 code bridge exited unexpectedly (code=17, signal=null)",
    );
    await controller.close();
  });

  it("kills the recorded Chrome process group after an unexpected bridge exit", async () => {
    if (process.platform === "win32") return;
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const child = new FakeBridgeChild();
      child.onRequest = (request) => {
        if (request.type === "init") {
          child.respond({
            id: request.id,
            ok: true,
            result: { browserPid: 424_242 },
          });
          return;
        }
        if (request.type === "execute") child.exit(17, null);
      };
      const { forkProcess } = makeFork(child);
      const controller = await startV4CodeController({
        sdkPath: "/synthetic/v4-sdk.ts",
        bridgePath: "/synthetic/v4CodeBridge.ts",
        forkProcess,
        startupTimeoutMs: 100,
        executeTimeoutMs: 100,
        closeTimeoutMs: 100,
      });

      await expect(
        controller.execute({ code: "return 1", startUrl: "", task: {} }),
      ).rejects.toThrow("V4 code bridge exited unexpectedly");
      expect(kill).toHaveBeenCalledWith(-424_242, "SIGKILL");
      await controller.close();
    } finally {
      kill.mockRestore();
    }
  });

  it("kills Chrome when the bridge exits before acknowledging close", async () => {
    if (process.platform === "win32") return;
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const child = new FakeBridgeChild();
      child.onRequest = (request) => {
        if (request.type === "init") {
          child.respond({
            id: request.id,
            ok: true,
            result: { browserPid: 424_243 },
          });
          return;
        }
        if (request.type === "close") child.exit(19, null);
      };
      const { forkProcess } = makeFork(child);
      const controller = await startV4CodeController({
        sdkPath: "/synthetic/v4-sdk.ts",
        bridgePath: "/synthetic/v4CodeBridge.ts",
        forkProcess,
        startupTimeoutMs: 100,
        executeTimeoutMs: 100,
        closeTimeoutMs: 100,
      });

      await expect(controller.close()).rejects.toThrow(
        "V4 code bridge exited unexpectedly",
      );
      expect(kill).toHaveBeenCalledWith(-424_243, "SIGKILL");
    } finally {
      kill.mockRestore();
    }
  });

  it("kills Chrome discovered from its PID file when initialization aborts", async () => {
    if (process.platform === "win32") return;
    const workingDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "v4-controller-abort-"),
    );
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const child = new FakeBridgeChild();
      child.onRequest = (request) => {
        if (request.type !== "init") return;
        fs.writeFileSync(
          path.join(workingDirectory, "v4-browser-profile", "chrome.pid"),
          "424244",
        );
        child.respond({
          id: request.id,
          ok: false,
          error: { name: "Error", message: "init failed after launch" },
        });
      };
      const { forkProcess } = makeFork(child);

      await expect(
        startV4CodeController({
          sdkPath: "/synthetic/v4-sdk.ts",
          bridgePath: "/synthetic/v4CodeBridge.ts",
          forkProcess,
          workingDirectory,
          startupTimeoutMs: 100,
          executeTimeoutMs: 100,
          closeTimeoutMs: 100,
        }),
      ).rejects.toThrow("init failed after launch");
      expect(kill).toHaveBeenCalledWith(-424_244, "SIGKILL");
    } finally {
      kill.mockRestore();
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("times out execution and tears down the child", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeBridgeChild();
      child.onRequest = (request) => {
        if (request.type === "init") {
          child.respond({ id: request.id, ok: true });
        }
      };
      const { forkProcess } = makeFork(child);
      const controllerPromise = startV4CodeController({
        sdkPath: "/synthetic/v4-sdk.ts",
        bridgePath: "/synthetic/v4CodeBridge.ts",
        forkProcess,
        startupTimeoutMs: 100,
        executeTimeoutMs: 25,
        closeTimeoutMs: 100,
      });
      await vi.runAllTicks();
      const controller = await controllerPromise;
      const execution = controller.execute({
        code: "return new Promise(() => {})",
        startUrl: "",
        task: {},
      });
      const rejection = expect(execution).rejects.toThrow(
        "V4 code bridge execute timed out after 25ms",
      );
      await vi.advanceTimersByTimeAsync(25);

      await rejection;
      expect(child.disconnectCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      name: "extension upload settles after startup timeout",
      uploadDelayMs: 3_000,
      sessionDelayMs: 0,
    },
    {
      name: "session creation settles after startup timeout",
      uploadDelayMs: 0,
      sessionDelayMs: 3_000,
    },
  ])(
    "keeps lifecycle IPC open when $name",
    async ({ uploadDelayMs, sessionDelayMs }) => {
      const fixture = makeDelayedBrowserbaseSdk({
        uploadDelayMs,
        sessionDelayMs,
      });
      const cleanupInputs: unknown[] = [];
      try {
        await expect(
          startV4CodeController({
            browser: { type: "browserbase", apiKey: "private-api-key" },
            sdkPath: fixture.sdkPath,
            cleanupBrowserbaseResources: async (cleanupInput) => {
              cleanupInputs.push(cleanupInput);
            },
            cleanupBrowserbaseResourcesSync: vi.fn(),
            startupTimeoutMs: 2_500,
            executeTimeoutMs: 100,
            closeTimeoutMs: 100,
          }),
        ).rejects.toThrow("V4 code bridge init timed out after 2500ms");

        expect(cleanupInputs.at(-1)).toEqual({
          apiKey: "private-api-key",
          resources: {
            extensionId: "late-extension-resource",
            sessionId: "late-session-resource",
          },
        });
      } finally {
        fs.rmSync(fixture.directory, { recursive: true, force: true });
      }
    },
    15_000,
  );
});
